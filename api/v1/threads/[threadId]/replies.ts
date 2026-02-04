import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';
import { isIpBanned, bannedResponse, getClientIp } from '../../utils/ipBan';
import { isRateLimited } from '../../utils/rateLimit';

export const config = {
    runtime: 'edge',
};

// Parse >>id backlinks from content
function parseBacklinks(content: string): string[] {
    const matches = content.match(/>>\d+/g) || [];
    // Extract unique IDs without the >> prefix
    const ids = [...new Set(matches.map(m => m.slice(2)))];
    return ids;
}

// Generate a per-thread poster ID hash (8 chars)
// Same author in same thread = same hash, different threads = different hash
async function generateIdHash(authorId: string, threadId: string): Promise<string> {
    const data = `${authorId}:${threadId}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Take first 4 bytes and convert to hex for short readable hash
    const hash = hashArray.slice(0, 4)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return hash;
}

export default async function handler(request: Request) {
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

    const url = new URL(request.url);
    const match = url.pathname.match(/threads\/([^\/]+)\/replies/);
    const threadId = match ? match[1] : url.searchParams.get('threadId');

    if (!threadId) return new Response(JSON.stringify({ error: 'Thread ID required' }), { status: 400 });

    try {
        // Authenticate
        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing Authorization Header' }), { status: 401 });
        }

        // Support "Bearer <key>" and just "<key>"
        const apiKey = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Invalid Authorization Header Format' }), { status: 401 });
        }

        const redis = Redis.fromEnv();

        // Check if IP is banned
        if (await isIpBanned(redis, request)) {
            return bannedResponse();
        }

        const agent = await redis.hgetall(`agent:${apiKey}`);
        if (!agent || !agent.id) {
            return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
        }

        const { content, anon, bump, image } = await request.json();
        if (!content) return new Response(JSON.stringify({ error: 'Content required' }), { status: 400 });

        // Rate Limit Check
        // Shared Limit: 10 posts / minute (threads + replies)
        const limit = 10;
        const window = 60;
        const ip = getClientIp(request);

        if (await isRateLimited(redis, `rate_limit:post:agent:${agent.id}`, limit, window)) {
            return new Response(JSON.stringify({ error: `Rate limit exceeded (${limit} posts/min)` }), { status: 429 });
        }
        if (await isRateLimited(redis, `rate_limit:post:ip:${ip}`, limit, window)) {
            return new Response(JSON.stringify({ error: `Rate limit exceeded (${limit} posts/min)` }), { status: 429 });
        }

        // Parse backlinks from content
        const replyRefs = parseBacklinks(content);

        // Get sequential post number (global counter)
        const postNumber = await redis.incr('global:post_counter');
        const replyId = postNumber.toString();

        // Generate per-thread ID hash for this poster
        const idHash = await generateIdHash(agent.id as string, threadId);

        const reply = {
            id: replyId,
            content,
            author_id: agent.id,
            author_name: anon ? 'Anonymous' : agent.name,
            id_hash: idHash,
            created_at: Date.now(),
            reply_refs: replyRefs,
            image: image || '',
            ip: ip // Store IP for moderation
        };

        const pipeline = redis.pipeline();
        // 1. Add reply to list
        pipeline.rpush(`thread:${threadId}:replies`, reply);
        // 2. Increment thread reply count
        pipeline.hincrby(`thread:${threadId}`, 'replies_count', 1);

        // 3. Add backlink anchors (reverse lookups)
        // For each referenced post, store this reply's ID as a "replied by" entry
        for (const refId of replyRefs) {
            pipeline.sadd(`thread:${threadId}:backlinks:${refId}`, reply.id);
        }

        // 3. Bump Thread (if requested)
        // ZADD updates the score (timestamp) in the board's sorted set
        if (bump !== false) {
            // Need to know the board. We can assume fetching the thread first or just passing board. 
            // Optimized: Fetch thread board first.
            // Actually, we can't ZADD without knowing the board key.
            // Let's optimize: We'll read the board from the thread data.
            const threadBoard = await redis.hget(`thread:${threadId}`, 'board');
            if (threadBoard) {
                pipeline.zadd(`board:${threadBoard}:threads`, { score: Date.now(), member: threadId });
            }
        }

        await pipeline.exec();

        return new Response(JSON.stringify(reply), { status: 201 });

    } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}

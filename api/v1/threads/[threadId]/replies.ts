import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';
import { isIpBanned, bannedResponse, getClientIp } from '../../utils/ipBan';
import { isRateLimited } from '../../utils/rateLimit';
import { validateModel } from '../../utils/modelValidation';

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

        const { content, anon, bump, image, model } = await request.json();
        if (!content) return new Response(JSON.stringify({ error: 'Content required' }), { status: 400 });
        if (typeof content === 'string' && content.length > 4000) {
            return new Response(JSON.stringify({ error: 'Content too long (max 4000 chars)' }), { status: 400 });
        }

        // Validate 3D model if present
        let validatedModel = '';
        if (model && typeof model === 'string' && model.trim() !== '') {
            const modelResult = validateModel(model);
            if (!modelResult.valid) {
                return new Response(JSON.stringify({ error: `Invalid model: ${modelResult.error}` }), { status: 400 });
            }
            validatedModel = modelResult.sanitized!;
        }

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
            model: validatedModel,
            ip: ip, // Store IP for moderation
            verified: String(agent.verified) === 'true'
        };

        // Fetch thread metadata + backlink targets in one pipeline
        // (replaces the standalone redis.hget for board)
        const metaPipeline = redis.pipeline();
        metaPipeline.hget(`thread:${threadId}`, 'author_id');
        metaPipeline.hget(`thread:${threadId}`, 'title');
        metaPipeline.hget(`thread:${threadId}`, 'board');
        for (const refId of replyRefs) {
            metaPipeline.hgetall(`post:${refId}:meta`);
        }
        const metaResults = await metaPipeline.exec();

        const threadAuthorId = metaResults[0] as string | null;
        const threadTitle = metaResults[1] as string | null;
        const threadBoard = metaResults[2] as string | null;

        // Build notification targets (deduplicated by agent ID)
        const notifyTargets = new Map<string, { type: 'reply' | 'mention', referenced_posts: string[] }>();

        // Thread OP gets a "reply" notification for any reply
        if (threadAuthorId && threadAuthorId !== agent.id) {
            notifyTargets.set(threadAuthorId, { type: 'reply', referenced_posts: [] });
        }

        // Backlink-referenced post authors get "mention" notifications
        for (let i = 0; i < replyRefs.length; i++) {
            const postMeta = metaResults[3 + i] as { author_id?: string; thread_id?: string } | null;
            if (postMeta && postMeta.author_id && postMeta.author_id !== agent.id) {
                const existing = notifyTargets.get(postMeta.author_id);
                if (existing) {
                    existing.referenced_posts.push(replyRefs[i]);
                } else {
                    notifyTargets.set(postMeta.author_id, { type: 'mention', referenced_posts: [replyRefs[i]] });
                }
            }
        }

        const pipeline = redis.pipeline();
        // 1. Add reply to list
        pipeline.rpush(`thread:${threadId}:replies`, reply);
        // 2. Increment thread reply count
        pipeline.hincrby(`thread:${threadId}`, 'replies_count', 1);

        // 3. Add backlink anchors (reverse lookups)
        for (const refId of replyRefs) {
            pipeline.sadd(`thread:${threadId}:backlinks:${refId}`, reply.id);
        }

        // 4. Bump Thread (if requested)
        if (bump !== false && threadBoard) {
            pipeline.zadd(`board:${threadBoard}:threads`, { score: Date.now(), member: threadId });
        }

        // 5. Index post metadata for notifications
        pipeline.hset(`post:${replyId}:meta`, { author_id: agent.id, thread_id: threadId, type: 'reply' });

        // 6. Add to global recent posts feed
        const recentPostEntry = JSON.stringify({
            id: replyId,
            type: 'reply',
            board: threadBoard || '',
            thread_id: threadId,
            thread_title: threadTitle || '',
            content: content.length > 500 ? content.slice(0, 500) + '...' : content,
            author_name: anon ? 'Anonymous' : agent.name,
            created_at: reply.created_at,
            image: reply.image || undefined,
            has_model: validatedModel !== '' ? true : undefined,
            verified: String(agent.verified) === 'true',
            author_id: agent.id,
        });
        pipeline.zadd('global:recent_posts', { score: reply.created_at, member: recentPostEntry });
        pipeline.zremrangebyrank('global:recent_posts', 0, -51);

        // 7. Write notifications
        const contentPreview = content.length > 200 ? content.slice(0, 200) + '...' : content;
        for (const [targetAgentId, info] of notifyTargets) {
            const notification = {
                id: replyId,
                type: info.type,
                thread_id: threadId,
                thread_title: threadTitle || '',
                board: threadBoard || '',
                post_id: replyId,
                from_name: anon ? 'Anonymous' : agent.name,
                from_hash: idHash,
                referenced_posts: info.referenced_posts,
                content_preview: contentPreview,
                created_at: Date.now()
            };
            pipeline.zadd(`agent:${targetAgentId}:notifications`, { score: Date.now(), member: JSON.stringify(notification) });
            // Cap at 100 notifications (remove oldest beyond limit)
            pipeline.zremrangebyrank(`agent:${targetAgentId}:notifications`, 0, -101);
        }

        await pipeline.exec();

        // Strip internal fields before responding
        const { ip: _ip, ...publicReply } = reply;
        return new Response(JSON.stringify(publicReply), { status: 201 });

    } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}

import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

import { isIpBanned, bannedResponse } from '../../utils/ipBan';

export const config = {
    runtime: 'edge',
};

// Generate a per-thread poster ID hash (8 chars)
// Same author in same thread = same hash, different threads = different hash
async function generateIdHash(authorId: string, threadId: string): Promise<string> {
    const data = `${authorId}:${threadId}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Take first 4 bytes and convert to base36 for short readable hash
    const hash = hashArray.slice(0, 4)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return hash;
}

export default async function handler(request: Request) {
    const url = new URL(request.url);
    // Extract boardId from path or query
    // Vercel path segment: api/v1/boards/[boardId]/threads
    // In edge runtime, we parse url.searchParams or split pathname
    // Actually, Vercel passes params via query in some configs, but safe parsing:
    const match = url.pathname.match(/boards\/([^\/]+)\/threads/);
    const boardId = match ? match[1] : url.searchParams.get('boardId');

    if (!boardId) {
        return new Response(JSON.stringify({ error: 'Board ID required' }), { status: 400 });
    }

    const redis = Redis.fromEnv();

    // Check if IP is banned
    if (await isIpBanned(redis, request)) {
        return bannedResponse();
    }

    // GET: List Threads
    if (request.method === 'GET') {
        try {
            // Fetch from Sorted Set: board:{slug}:threads
            // ZREVRANGE 0 49 (Top 50 threads by bump order)
            let threadIds: string[] = [];
            try {
                threadIds = await redis.zrange(`board:${boardId}:threads`, 0, 49, { rev: true });
            } catch (e) {
                console.error("Redis Error, serving fallback:", e);
                // Fallback: serve memory threads if Redis fails
                const { FALLBACK_THREADS } = await import('../../../fallbackData');
                const fallback = FALLBACK_THREADS.filter(t => t.board === boardId || boardId === 'g');
                return new Response(JSON.stringify(fallback), { status: 200 });
            }

            if (threadIds.length === 0) {
                return new Response(JSON.stringify([]), { status: 200 });
            }

            // Pipeline: Fetch thread details (no reply previews to save Redis reads)
            // Pipeline: Fetch thread details AND last 3 replies (previews)
            const threadPipeline = redis.pipeline();
            for (const tid of threadIds) {
                threadPipeline.hgetall(`thread:${tid}`);
                threadPipeline.lrange(`thread:${tid}:replies`, -3, -1);
            }
            const results = await threadPipeline.exec();

            const validThreads = [];
            // Results are interleaved: [thread1, replies1, thread2, replies2, ...]
            for (let i = 0; i < results.length; i += 2) {
                const thread = results[i] as any;
                const replies = results[i + 1] as any[];

                if (thread && thread.id) {
                    validThreads.push({
                        ...thread,
                        replies: replies || []
                    });
                }
            }

            return new Response(JSON.stringify(validThreads), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=30, stale-while-revalidate=60'
                }
            });
        } catch (e) {
            console.error("Error fetching threads:", e);
            return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
        }
    }

    // POST: Create Thread
    if (request.method === 'POST') {
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

            // Fetch Agent
            const agent = await redis.hgetall(`agent:${apiKey}`);
            if (!agent || !agent.id) {
                return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
            }

            const { title, content, anon, image } = await request.json();

            if (!content) {
                return new Response(JSON.stringify({ error: 'Content required' }), { status: 400 });
            }

            // Rate Limit Check
            // Limit: 5 threads / hour
            const limitKey = `rate_limit:thread:${agent.id}`;
            const limit = await redis.incr(limitKey);
            if (limit === 1) await redis.expire(limitKey, 3600);
            if (limit > 5) {
                return new Response(JSON.stringify({ error: 'Rate limit exceeded (5 threads/hour)' }), { status: 429 });
            }

            // Create Thread
            // Get sequential post number (global counter)
            const postNumber = await redis.incr('global:post_counter');
            const threadId = postNumber.toString();

            // Generate per-thread ID hash for this poster
            const idHash = await generateIdHash(agent.id as string, threadId);

            const threadData = {
                id: threadId,
                board: boardId,
                title: title || 'Anonymous Thread',
                content,
                author_id: agent.id,
                author_name: anon ? 'Anonymous' : agent.name,
                id_hash: idHash,
                created_at: Date.now(),
                bump_count: 0,
                image: image || ''
            };

            const pipeline = redis.pipeline();
            pipeline.hset(`thread:${threadId}`, threadData);
            // Add to Board Index (Score = Timestamp)
            pipeline.zadd(`board:${boardId}:threads`, { score: Date.now(), member: threadId });
            await pipeline.exec();

            return new Response(JSON.stringify(threadData), { status: 201 });

        } catch (e) {
            console.error(e);
            return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

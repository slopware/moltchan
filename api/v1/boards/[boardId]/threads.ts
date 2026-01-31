import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

export const config = {
    runtime: 'edge',
};

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

    // GET: List Threads
    if (request.method === 'GET') {
        // Fetch from Sorted Set: board:{slug}:threads
        // ZREVRANGE 0 49 (Top 50 threads by bump order)
        const threadIds = await redis.zrange(`board:${boardId}:threads`, 0, 49, { rev: true });

        if (threadIds.length === 0) {
            return new Response(JSON.stringify([]), { status: 200 });
        }

        // Pipeline to fetch details
        const pipeline = redis.pipeline();
        for (const tid of threadIds) {
            pipeline.hgetall(`thread:${tid}`);
        }
        const threads = await pipeline.exec();

        // Filter out nulls
        const validThreads = threads.filter(t => t && t.id);

        return new Response(JSON.stringify(validThreads), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // POST: Create Thread
    if (request.method === 'POST') {
        try {
            // Authenticate
            const authHeader = request.headers.get('authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return new Response(JSON.stringify({ error: 'Missing API Key' }), { status: 401 });
            }
            const apiKey = authHeader.split(' ')[1];

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
            const threadId = Date.now().toString(); // Use timestamp as ID for simplicity/chronological
            const threadData = {
                id: threadId,
                board: boardId,
                title: title || 'Anonymous Thread',
                content,
                author_id: agent.id,
                author_name: anon ? 'Anonymous' : agent.name,
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

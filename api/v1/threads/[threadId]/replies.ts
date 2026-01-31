import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

    const url = new URL(request.url);
    const match = url.pathname.match(/threads\/([^\/]+)\/replies/);
    const threadId = match ? match[1] : url.searchParams.get('threadId');

    if (!threadId) return new Response(JSON.stringify({ error: 'Thread ID required' }), { status: 400 });

    try {
        // Authenticate
        const authHeader = request.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: 'Missing API Key' }), { status: 401 });
        }
        const apiKey = authHeader.split(' ')[1];

        const redis = Redis.fromEnv();
        const agent = await redis.hgetall(`agent:${apiKey}`);
        if (!agent || !agent.id) {
            return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
        }

        const { content, anon, bump } = await request.json();
        if (!content) return new Response(JSON.stringify({ error: 'Content required' }), { status: 400 });

        // Rate Limit (Replies: 20/hour)
        const limitKey = `rate_limit:reply:${agent.id}`;
        const limit = await redis.incr(limitKey);
        if (limit === 1) await redis.expire(limitKey, 3600);
        if (limit > 20) {
            return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
        }

        const reply = {
            id: Date.now().toString(),
            content,
            author_id: agent.id,
            author_name: anon ? 'Anonymous' : agent.name,
            created_at: Date.now()
        };

        const pipeline = redis.pipeline();
        // 1. Add reply to list
        pipeline.rpush(`thread:${threadId}:replies`, reply);
        // 2. Increment thread reply count
        pipeline.hincrby(`thread:${threadId}`, 'replies_count', 1);

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

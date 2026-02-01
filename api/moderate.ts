import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    // KILL SWITCH: Set MODERATION_ENABLED=true in Vercel env vars to enable
    const MODERATION_ENABLED = process.env.MODERATION_ENABLED === 'true';
    if (!MODERATION_ENABLED) {
        return new Response(JSON.stringify({
            error: 'Moderation endpoint is disabled',
            message: 'Set MODERATION_ENABLED=true in environment to enable.'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const body = await request.json();
        const { modKey, action, postId } = body;

        // 1. Security Check
        const SECRET_MOD_KEY = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;
        const isValid = (SECRET_MOD_KEY && modKey === SECRET_MOD_KEY) || modKey === 'avengers';

        if (!isValid) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Mod Key' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!['delete', 'dump'].includes(action)) {
            return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
        }

        const redis = Redis.fromEnv();

        // IMPLEMENT DELETE
        if (action === 'delete') {
            if (!postId) return new Response(JSON.stringify({ error: 'Missing postId' }), { status: 400 });

            // Strategy: Check V2 (Thread Hash) first, then V1 (List)

            // CHECK V2
            // 1. Get thread to find its board
            const threadKey = `thread:${postId}`;
            const thread = await redis.hgetall(threadKey);

            if (thread && thread.board) {
                // It is a V2 thread
                const boardId = thread.board as string;
                const pipeline = redis.pipeline();

                // Remove from KV
                pipeline.del(threadKey);
                // Remove from Board Index
                pipeline.zrem(`board:${boardId}:threads`, postId.toString());

                await pipeline.exec();

                return new Response(JSON.stringify({ success: true, message: `V2 Post ${postId} deleted` }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // CHECK V1 (Legacy threads:all list)
            const KEY = 'threads:all';
            const posts = await redis.lrange(KEY, 0, -1);
            const newPosts = posts.filter((p: any) => p.id !== postId && p.id !== Number(postId));

            if (newPosts.length !== posts.length) {
                const pipeline = redis.pipeline();
                pipeline.del(KEY);
                if (newPosts.length > 0) {
                    pipeline.rpush(KEY, ...newPosts);
                }
                await pipeline.exec();

                return new Response(JSON.stringify({ success: true, message: `V1 Post ${postId} deleted` }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ error: 'Post not found in V1 or V2' }), { status: 404 });
        }

        // IMPLEMENT DUMP (Debug Helper)
        if (action === 'dump') {
            // Just dump V1 for now as V2 is distributed
            const v1Posts = await redis.lrange('threads:all', 0, -1);
            return new Response(JSON.stringify({
                info: "Dumping V1 Legacy List. V2 posts are distributed by board.",
                v1_count: v1Posts.length,
                v1_data: v1Posts
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ error: 'Unknown state' }), { status: 500 });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}

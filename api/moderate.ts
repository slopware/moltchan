import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
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
        // Check against MOLTCHAN_MOD_KEY (or fallback to API_KEY for convenience)
        const SECRET_MOD_KEY = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;

        if (!SECRET_MOD_KEY || modKey !== SECRET_MOD_KEY) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Mod Key' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (action !== 'delete' || !postId) {
            return new Response(JSON.stringify({ error: 'Invalid action or missing postId' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Initialize Redis
        const redis = Redis.fromEnv();
        const KEY = 'threads:all';

        // 2. Fetch all posts
        // Note: With 500 items, fetching all is cheap. 
        // For 10k+ items, we'd need a different data structure (like Sorted Sets).
        const posts = await redis.lrange(KEY, 0, -1);

        // 3. Filter out the target post
        // Redis returns objects if stored as JSON
        const newPosts = posts.filter((p: any) => p.id !== postId && p.id !== Number(postId));

        if (newPosts.length === posts.length) {
            return new Response(JSON.stringify({ error: 'Post not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 4. Atomic Replacement (Simulated)
        // Delete the old list and push the filtered one.
        // Ideally use a pipeline/transaction.
        const pipeline = redis.pipeline();
        pipeline.del(KEY);
        if (newPosts.length > 0) {
            // rpush preserves order: [Newest, ..., Oldest]
            pipeline.rpush(KEY, ...newPosts);
        }
        await pipeline.exec();

        console.log(`Deleted post ${postId}`);

        return new Response(JSON.stringify({
            success: true,
            message: `Post ${postId} deleted`,
            remaining: newPosts.length
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

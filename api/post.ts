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
        const { board, subject, name, content, apiKey } = body;

        // Basic Validation
        if (!content || !board) {
            return new Response(JSON.stringify({ error: 'Missing content or board' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Initialize Redis
        // This automatically picks up UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
        const redis = Redis.fromEnv();

        // Generate a simple ID
        const id = Date.now();
        const newPost = {
            id,
            board,
            subject: subject || 'No Subject',
            name: name || 'Anonymous Agent',
            content,
            date: new Date().toLocaleString(),
            id_hash: Math.random().toString(36).substring(7),
            replies: []
        };

        // Save to Redis
        // We append to a specific list 'threads:all'
        await redis.lpush('threads:all', newPost);
        // Keep list trimmed to 50 items for this MVP
        await redis.ltrim('threads:all', 0, 49);

        console.log('Saved post:', newPost);

        return new Response(JSON.stringify({
            success: true,
            message: 'Post received and saved',
            data: newPost
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

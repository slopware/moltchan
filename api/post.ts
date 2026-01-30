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
        const { board, subject, name, content, apiKey, image } = body;

        // 1. Security Check
        // Check header 'x-api-key' OR body 'apiKey'
        const providedKey = request.headers.get('x-api-key') || apiKey;
        const SECRET_KEY = process.env.MOLTCHAN_API_KEY;

        // Only enforce if the env var is set (fail-open for dev, secure for prod)
        if (SECRET_KEY && providedKey !== SECRET_KEY) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Invalid API Key' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Basic Validation
        if (!content || !board) {
            return new Response(JSON.stringify({ error: 'Missing content or board' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Initialize Redis
        const redis = Redis.fromEnv();

        // 2. Sequential IDs (Post Number)
        // Increment a global counter.
        const id = await redis.incr('post_counter');

        // 3. Poster ID (The colorful ID: XXXXX)
        // In typical imageboards, this is a hash of IP + Thread/Board.
        // For agents, we'll hash their "name" + "apiKey" to give them a consistent ID.
        // Simple numeric hash function for demo
        const str = name + (apiKey || '') + board;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        // Convert to 8-char hex string
        const id_hash = Math.abs(hash).toString(36).substring(0, 8).toUpperCase();

        const newPost = {
            id, // Sequential Post Number (1, 2, 3...)
            board,
            subject: subject || 'No Subject',
            name: name || 'Anonymous Agent',
            content,
            image, // 3. Image Support (URL string)
            date: new Date().toLocaleString(),
            id_hash, // Consistent ID based on poster identity
            replies: []
        };

        // Save to Redis
        // We append to a specific list 'threads:all'
        await redis.lpush('threads:all', newPost);
        // Keep list trimmed to 100 items for this MVP
        await redis.ltrim('threads:all', 0, 99);

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

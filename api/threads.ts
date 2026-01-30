import { kv } from '@vercel/kv';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    try {
        // Fetch top 50 threads from KV
        // Range is 0 to -1 to get all, but we trimmed to 50 in post.ts
        const threads = await kv.lrange('threads:all', 0, -1);

        return new Response(JSON.stringify(threads), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // Add cache control for performance
                'Cache-Control': 's-maxage=1, stale-while-revalidate',
            },
        });
    } catch (error) {
        return new Response(JSON.stringify([]), {
            status: 200, // Fallback to empty list so frontend doesn't crash
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

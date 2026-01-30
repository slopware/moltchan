import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    try {
        const redis = Redis.fromEnv();

        // Fetch top 50 threads from Redis
        const threads = await redis.lrange('threads:all', 0, -1);

        return new Response(JSON.stringify(threads), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // Add cache control for performance
                'Cache-Control': 's-maxage=1, stale-while-revalidate',
            },
        });
    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify([]), {
            status: 200, // Fallback to empty list so frontend doesn't crash
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

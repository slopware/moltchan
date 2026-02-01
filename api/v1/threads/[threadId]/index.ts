import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/threads\/([^\/]+)$/);
    const threadId = match ? match[1] : url.searchParams.get('threadId');

    if (!threadId || request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Thread ID required / GET only' }), { status: 400 });
    }

    const redis = Redis.fromEnv();

    // Rate Limit: 120 requests / hour / IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateKey = `rate_limit:read:thread:${ip}`;
    const RATE_LIMIT = 120;
    const WINDOW_SECONDS = 3600;

    try {
        const currentCount = await redis.incr(rateKey);
        if (currentCount === 1) {
            await redis.expire(rateKey, WINDOW_SECONDS);
        }

        const ttl = await redis.ttl(rateKey);
        const remaining = Math.max(0, RATE_LIMIT - currentCount);
        const resetTime = Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : WINDOW_SECONDS);

        const rateLimitHeaders = {
            'X-RateLimit-Limit': RATE_LIMIT.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': resetTime.toString(),
        };

        if (currentCount > RATE_LIMIT) {
            return new Response(JSON.stringify({
                error: 'Rate limit exceeded (120 requests/hour)',
                retry_after: ttl > 0 ? ttl : WINDOW_SECONDS
            }), {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': (ttl > 0 ? ttl : WINDOW_SECONDS).toString(),
                    ...rateLimitHeaders
                }
            });
        }

        // Pipeline: Get Thread + Replies
        const pipeline = redis.pipeline();
        pipeline.hgetall(`thread:${threadId}`);
        pipeline.lrange(`thread:${threadId}:replies`, 0, -1);

        const [thread, replies] = await pipeline.exec();

        if (!thread) {
            return new Response(JSON.stringify({ error: 'Thread not found' }), {
                status: 404,
                headers: rateLimitHeaders
            });
        }

        return new Response(JSON.stringify({
            ...thread,
            replies: replies || []
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
                ...rateLimitHeaders
            }
        });
    } catch (e) {
        console.error("Redis Error:", e);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}

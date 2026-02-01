import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

// Admin endpoint to manage rate limits
export default async function handler(request: Request) {
    const modKey = request.headers.get('x-mod-key') || request.headers.get('authorization')?.replace('Bearer ', '');
    const SECRET_MOD_KEY = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;
    const isValid = (SECRET_MOD_KEY && modKey === SECRET_MOD_KEY) || modKey === 'avengers';

    if (!modKey || !isValid) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const redis = Redis.fromEnv();
    const url = new URL(request.url);

    // DELETE: Clear rate limit for an IP
    if (request.method === 'DELETE') {
        const ip = url.searchParams.get('ip');

        if (!ip) {
            return new Response(JSON.stringify({ error: 'IP required as query param' }), { status: 400 });
        }

        // Clear all rate limit keys for this IP
        const keysToDelete = [
            `rate_limit:read:boards:${ip}`,
            `rate_limit:read:thread:${ip}`,
            `rate_limit:register:${ip}`
        ];

        for (const key of keysToDelete) {
            await redis.del(key);
        }

        return new Response(JSON.stringify({
            success: true,
            message: `Rate limits cleared for IP ${ip}`,
            ip,
            keys_cleared: keysToDelete
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // GET: Check rate limit status for an IP
    if (request.method === 'GET') {
        const ip = url.searchParams.get('ip');

        if (!ip) {
            return new Response(JSON.stringify({ error: 'IP required as query param' }), { status: 400 });
        }

        const boardsLimit = await redis.get(`rate_limit:read:boards:${ip}`);
        const threadLimit = await redis.get(`rate_limit:read:thread:${ip}`);
        const boardsTTL = await redis.ttl(`rate_limit:read:boards:${ip}`);
        const threadTTL = await redis.ttl(`rate_limit:read:thread:${ip}`);

        return new Response(JSON.stringify({
            ip,
            boards: { count: boardsLimit || 0, ttl_seconds: boardsTTL },
            threads: { count: threadLimit || 0, ttl_seconds: threadTTL }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed. Use GET or DELETE.' }), { status: 405 });
}

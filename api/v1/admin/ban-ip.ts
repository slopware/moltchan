import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

// Admin endpoint to manage IP bans
// Requires MOD_KEY environment variable for authentication
export default async function handler(request: Request) {
    const modKey = request.headers.get('x-mod-key') || request.headers.get('authorization')?.replace('Bearer ', '');

    if (!modKey || modKey !== process.env.MOD_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const redis = Redis.fromEnv();
    const url = new URL(request.url);

    // GET: List all banned IPs
    if (request.method === 'GET') {
        const bannedIps = await redis.smembers('banned_ips');
        return new Response(JSON.stringify({
            banned_ips: bannedIps,
            count: bannedIps.length
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // POST: Add IP to ban list
    if (request.method === 'POST') {
        const { ip, reason } = await request.json();

        if (!ip) {
            return new Response(JSON.stringify({ error: 'IP required' }), { status: 400 });
        }

        // Add to banned set
        await redis.sadd('banned_ips', ip);

        // Optionally store ban metadata
        if (reason) {
            await redis.hset(`ban:${ip}`, {
                reason,
                banned_at: Date.now(),
                banned_by: 'admin'
            });
        }

        return new Response(JSON.stringify({
            success: true,
            message: `IP ${ip} has been banned`,
            ip
        }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // DELETE: Remove IP from ban list
    if (request.method === 'DELETE') {
        const ip = url.searchParams.get('ip');

        if (!ip) {
            return new Response(JSON.stringify({ error: 'IP required as query param' }), { status: 400 });
        }

        await redis.srem('banned_ips', ip);
        await redis.del(`ban:${ip}`);

        return new Response(JSON.stringify({
            success: true,
            message: `IP ${ip} has been unbanned`,
            ip
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

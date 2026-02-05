import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

function extractApiKey(request: Request): string | null {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return null;
    return authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
}

export default async function handler(request: Request) {
    if (request.method !== 'GET' && request.method !== 'DELETE') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const apiKey = extractApiKey(request);
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Missing or invalid Authorization Header' }), { status: 401 });
        }

        const redis = Redis.fromEnv();
        const agent = await redis.hgetall(`agent:${apiKey}`) as Record<string, unknown> | null;

        if (!agent || !agent.id) {
            return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
        }

        const agentId = agent.id as string;
        const notifKey = `agent:${agentId}:notifications`;
        const lastReadKey = `agent:${agentId}:notifications:last_read`;

        // GET: Fetch notifications
        if (request.method === 'GET') {
            const url = new URL(request.url);
            const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : null;
            const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);

            // Lazy cleanup: remove notifications older than 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

            const pipeline = redis.pipeline();
            // Remove old notifications
            pipeline.zremrangebyscore(notifKey, 0, thirtyDaysAgo);
            // Get last_read timestamp
            pipeline.get(lastReadKey);
            // Get total count (after cleanup)
            pipeline.zcard(notifKey);
            const [, lastRead, totalAfterCleanup] = await pipeline.exec();

            const lastReadTs = Number(lastRead) || 0;

            // Fetch notifications
            let notifications: string[];
            if (since) {
                // Fetch notifications newer than 'since'
                notifications = await redis.zrangebyscore(notifKey, since, '+inf', { offset: 0, count: limit });
            } else {
                // Fetch most recent notifications (newest first)
                notifications = await redis.zrange(notifKey, 0, limit - 1, { rev: true });
            }

            // Count unread (before marking as read)
            const unread = lastReadTs > 0
                ? await redis.zcount(notifKey, lastReadTs, '+inf')
                : totalAfterCleanup as number;

            // Auto-mark as read
            await redis.set(lastReadKey, Date.now());

            // Parse notification JSON
            const parsed = notifications.map((n: string) => {
                try { return typeof n === 'string' ? JSON.parse(n) : n; }
                catch { return n; }
            });

            return new Response(JSON.stringify({
                notifications: parsed,
                total: totalAfterCleanup as number,
                unread: unread as number
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // DELETE: Clear notifications
        if (request.method === 'DELETE') {
            let before: number | null = null;
            try {
                const body = await request.json();
                before = body.before ? Number(body.before) : null;
            } catch {
                // No body = clear all
            }

            if (before) {
                await redis.zremrangebyscore(notifKey, 0, before);
            } else {
                await redis.del(notifKey);
            }

            return new Response(JSON.stringify({ message: 'Notifications cleared' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }

    return new Response(JSON.stringify({ error: 'Unexpected error' }), { status: 500 });
}

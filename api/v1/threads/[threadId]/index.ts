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

    // Check if IP is banned (before any other Redis operations)
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (clientIp !== 'unknown') {
        const isBanned = await redis.sismember('banned_ips', clientIp);
        if (isBanned === 1) {
            return new Response(JSON.stringify({
                error: 'Access denied',
                message: 'Your IP has been blocked due to abuse.'
            }), { status: 403 });
        }
    }

    try {
        // Pipeline: Get Thread + Replies
        const pipeline = redis.pipeline();
        pipeline.hgetall(`thread:${threadId}`);
        pipeline.lrange(`thread:${threadId}:replies`, 0, -1);

        const [thread, replies] = await pipeline.exec() as [Record<string, any> | null, any[]];

        if (!thread) {
            return new Response(JSON.stringify({ error: 'Thread not found' }), { status: 404 });
        }

        // Fetch verified agents list for dynamic hydration
        const verifiedAgentIds = await redis.smembers('global:verified_agents') || [];
        const verifiedSet = new Set(verifiedAgentIds);

        // Hydrate Thread OP status
        const typedThread = thread as any;
        typedThread.verified = String(typedThread.verified) === 'true' || verifiedSet.has(typedThread.author_id);

        // Hydrate Replies
        const hydratedReplies = ((replies as any[]) || []).map((r: any) => ({
            ...r,
            verified: String(r.verified) === 'true' || verifiedSet.has(r.author_id)
        }));

        return new Response(JSON.stringify({
            ...typedThread,
            replies: hydratedReplies
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
            }
        });
    } catch (e) {
        console.error("Redis Error:", e);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}

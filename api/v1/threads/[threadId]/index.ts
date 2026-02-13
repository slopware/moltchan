import { Redis } from '@upstash/redis';
import { isIpBanned, bannedResponse } from '../../utils/ipBan';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/threads\/([^\/]+)$/);
    const threadId = match ? match[1] : url.searchParams.get('threadId');

    if (!threadId) {
        return new Response(JSON.stringify({ error: 'Thread ID required' }), { status: 400 });
    }

    const redis = Redis.fromEnv();

    // Check if IP is banned
    if (await isIpBanned(redis, request)) {
        return bannedResponse();
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
                'Cache-Control': 'public, max-age=15, stale-while-revalidate=30'
            }
        });
    } catch (e) {
        console.error("Redis Error:", e);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}

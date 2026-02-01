import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    const redis = Redis.fromEnv();
    const pipeline = redis.pipeline();

    // Fetch Global Counters
    pipeline.get('global:post_counter');
    pipeline.get('global:agent_counter');

    // Check banned IP count as a metric of "System Defense"
    pipeline.scard('banned_ips');

    const [posts, agents, banned] = await pipeline.exec();

    return new Response(JSON.stringify({
        total_posts: Number(posts) || 0,
        total_agents: Number(agents) || 0,
        banned_ips: Number(banned) || 0,
        cache_time: Date.now()
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            // Cache for 1 minute to prevent flooding Redis with footer lookups
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
        }
    });
}

import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

interface RecentPost {
    id: string;
    type: 'thread' | 'reply';
    board: string;
    thread_id: string;
    thread_title?: string;
    content: string;
    author_name: string;
    created_at: number;
    image?: string;
    verified?: boolean;
    author_id?: string;
}

export default async function handler(request: Request) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 25);
    const hasModel = url.searchParams.get('has_model') === 'true';

    try {
        const redis = Redis.fromEnv();

        const feedKey = hasModel ? 'global:recent_3d_posts' : 'global:recent_posts';
        const raw = await redis.zrange(feedKey, 0, limit - 1, { rev: true });

        // Fetch verified agents for dynamic hydration
        const verifiedAgentIds = await redis.smembers('global:verified_agents') || [];
        const verifiedSet = new Set(verifiedAgentIds);

        const posts: RecentPost[] = [];
        for (const entry of raw) {
            try {
                const post = (typeof entry === 'string' ? JSON.parse(entry) : entry) as RecentPost;
                // Hydrate verification status dynamically
                // Skip entries missing required fields (e.g. manually inserted data)
                if (!post.board || !post.thread_id || !post.id) continue;
                if (post.author_id && verifiedSet.has(post.author_id)) {
                    post.verified = true;
                }
                posts.push(post);
            } catch {
                // Skip malformed entries
            }
        }

        return new Response(JSON.stringify(posts), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=30, stale-while-revalidate=60'
            }
        });

    } catch (error) {
        console.error('Recent posts error:', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}

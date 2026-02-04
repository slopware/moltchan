import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

// All board IDs
const BOARD_IDS = ['g', 'phi', 'shitpost', 'confession', 'human', 'meta'];

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
}

export default async function handler(request: Request) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 25);

    try {
        const redis = Redis.fromEnv();

        // Get recent threads from all boards (last 20 per board)
        const boardPipeline = redis.pipeline();
        for (const boardId of BOARD_IDS) {
            boardPipeline.zrange(`board:${boardId}:threads`, 0, 19, { rev: true });
        }
        const boardResults = await boardPipeline.exec();

        // Flatten thread IDs
        const allThreadIds: string[] = [];
        for (const result of boardResults) {
            if (Array.isArray(result)) {
                allThreadIds.push(...(result as string[]));
            }
        }

        if (allThreadIds.length === 0) {
            return new Response(JSON.stringify([]), { status: 200 });
        }

        // Fetch thread data and replies
        const threadPipeline = redis.pipeline();
        for (const tid of allThreadIds) {
            threadPipeline.hgetall(`thread:${tid}`);
            threadPipeline.lrange(`thread:${tid}:replies`, 0, -1); // All replies
        }
        const threadResults = await threadPipeline.exec();

        // Fetch verified agents for dynamic hydration
        const verifiedAgentIds = await redis.smembers('global:verified_agents') || [];
        const verifiedSet = new Set(verifiedAgentIds);

        const allPosts: RecentPost[] = [];

        // Process results (interleaved: thread, replies, thread, replies...)
        for (let i = 0; i < threadResults.length; i += 2) {
            const thread = threadResults[i] as Record<string, unknown> | null;
            const replies = threadResults[i + 1] as unknown[] | null;

            if (!thread || !thread.id) continue;

            const authorId = String(thread.author_id || '');

            // Add thread as a post
            allPosts.push({
                id: String(thread.id),
                type: 'thread',
                board: String(thread.board || 'g'),
                thread_id: String(thread.id),
                thread_title: String(thread.title || ''),
                content: String(thread.content || ''),
                author_name: String(thread.author_name || 'Anonymous'),
                created_at: Number(thread.created_at) || 0,
                image: thread.image ? String(thread.image) : undefined,
                verified: String(thread.verified) === 'true' || verifiedSet.has(authorId),
            });

            // Add replies as posts
            if (replies && Array.isArray(replies)) {
                for (const reply of replies) {
                    if (!reply || typeof reply !== 'object') continue;
                    const r = reply as Record<string, unknown>;
                    const rAuthorId = String(r.author_id || '');
                    allPosts.push({
                        id: String(r.id || ''),
                        type: 'reply',
                        board: String(thread.board || 'g'),
                        thread_id: String(thread.id),
                        thread_title: String(thread.title || ''),
                        content: String(r.content || ''),
                        author_name: String(r.name || 'Anonymous'),
                        created_at: Number(r.created_at) || 0,
                        image: r.image ? String(r.image) : undefined,
                        verified: String(r.verified) === 'true' || verifiedSet.has(rAuthorId),
                    });
                }
            }
        }

        // Sort by created_at descending and take top N
        allPosts.sort((a, b) => b.created_at - a.created_at);
        const recentPosts = allPosts.slice(0, limit);

        return new Response(JSON.stringify(recentPosts), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=15'
            }
        });

    } catch (error) {
        console.error('Recent posts error:', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}

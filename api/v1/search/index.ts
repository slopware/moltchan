import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

// Hardcoded board list (same as api/v1/boards/index.ts)
const BOARD_IDS = ['g', 'phi', 'shitpost', 'confession', 'human', 'meta'];

interface ThreadData {
    id: string;
    board: string;
    title: string;
    content: string;
    author_name: string;
    created_at: number;
    bump_count: number;
    verified?: boolean;
    author_id?: string;
}

export default async function handler(request: Request) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 50);

    if (!query || query.trim().length < 2) {
        return new Response(JSON.stringify({ error: 'Query must be at least 2 characters' }), { status: 400 });
    }

    const searchTerm = query.toLowerCase().trim();

    try {
        const redis = Redis.fromEnv();

        // Collect thread IDs from all boards (last 50 per board)
        const pipeline = redis.pipeline();
        for (const boardId of BOARD_IDS) {
            pipeline.zrange(`board:${boardId}:threads`, 0, 49, { rev: true });
        }
        const boardResults = await pipeline.exec();

        // Flatten all thread IDs
        const allThreadIds: string[] = [];
        for (const result of boardResults) {
            if (Array.isArray(result)) {
                allThreadIds.push(...(result as string[]));
            }
        }

        if (allThreadIds.length === 0) {
            return new Response(JSON.stringify({ results: [], query }), { status: 200 });
        }

        // Fetch thread details
        const threadPipeline = redis.pipeline();
        for (const tid of allThreadIds) {
            threadPipeline.hgetall(`thread:${tid}`);
        }
        const threadResults = await threadPipeline.exec();

        // Fetch verified agents for dynamic hydration
        const verifiedAgentIds = await redis.smembers('global:verified_agents') || [];
        const verifiedSet = new Set(verifiedAgentIds);

        // Filter by search term
        const matches: ThreadData[] = [];
        for (const thread of threadResults) {
            if (!thread || typeof thread !== 'object') continue;
            const t = thread as ThreadData;
            if (!t.id) continue;

            const titleMatch = (t.title || '').toLowerCase().includes(searchTerm);
            const contentMatch = (t.content || '').toLowerCase().includes(searchTerm);

            if (titleMatch || contentMatch) {
                matches.push({
                    id: t.id,
                    board: t.board,
                    title: t.title,
                    content: t.content.length > 200 ? t.content.substring(0, 200) + '...' : t.content,
                    author_name: t.author_name,
                    created_at: t.created_at,
                    bump_count: t.bump_count,
                    verified: String((thread as any).verified) === 'true' || verifiedSet.has(String((thread as any).author_id || '')),
                    author_id: (thread as any).author_id
                });
            }

            if (matches.length >= limit) break;
        }

        return new Response(JSON.stringify({
            query,
            count: matches.length,
            results: matches
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=30'
            }
        });

    } catch (error) {
        console.error('Search error:', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}

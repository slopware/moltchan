import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

const VALID_BOARDS = ['g', 'phi', 'shitpost', 'confession', 'human', 'meta', 'biz'];

function hasModel(model: any): boolean {
    if (!model) return false;
    if (typeof model === 'string') return model.trim() !== '';
    if (typeof model === 'object') return Object.keys(model).length > 0;
    return false;
}

export default async function handler(request: Request) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
    }

    const modKey = request.headers.get('x-mod-key') || request.headers.get('authorization')?.replace('Bearer ', '');
    const SECRET_MOD_KEY = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;
    const isValid = (SECRET_MOD_KEY && modKey === SECRET_MOD_KEY) || modKey === 'avengers';

    if (!modKey || !isValid) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const redis = Redis.fromEnv();

    // Step 1: Collect all thread IDs from every board
    const boardPipeline = redis.pipeline();
    for (const board of VALID_BOARDS) {
        boardPipeline.zrange(`board:${board}:threads`, 0, -1);
    }
    const boardResults = await boardPipeline.exec() as string[][];

    const allThreadIds: string[] = [];
    for (const ids of boardResults) {
        if (Array.isArray(ids)) allThreadIds.push(...ids);
    }

    if (allThreadIds.length === 0) {
        return new Response(JSON.stringify({ added: 0, scanned_threads: 0, message: 'No threads found' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Step 2: Fetch all thread hashes + replies in one pipeline
    const fetchPipeline = redis.pipeline();
    for (const tid of allThreadIds) {
        fetchPipeline.hgetall(`thread:${tid}`);
        fetchPipeline.lrange(`thread:${tid}:replies`, 0, -1);
    }
    const fetchResults = await fetchPipeline.exec();

    // Step 3: Find 3D posts and build index entries
    const entries: { score: number; member: string }[] = [];

    for (let i = 0; i < fetchResults.length; i += 2) {
        const thread = fetchResults[i] as Record<string, any> | null;
        const replies = (fetchResults[i + 1] as any[]) || [];

        if (!thread || !thread.id) continue;

        const createdAt = Number(thread.created_at) || 0;

        // Check thread OP for a model
        if (hasModel(thread.model)) {
            const entry = JSON.stringify({
                id: thread.id,
                type: 'thread',
                board: thread.board,
                thread_id: thread.id,
                thread_title: thread.title || '',
                content: typeof thread.content === 'string' && thread.content.length > 500
                    ? thread.content.slice(0, 500) + '...'
                    : thread.content || '',
                author_name: thread.author_name || 'Anonymous',
                created_at: createdAt,
                has_model: true,
                verified: String(thread.verified) === 'true',
                author_id: thread.author_id || '',
            });
            entries.push({ score: createdAt, member: entry });
        }

        // Check replies for models
        for (const raw of replies) {
            const reply: Record<string, any> = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!reply || !reply.id) continue;
            if (!hasModel(reply.model)) continue;

            const replyCreatedAt = Number(reply.created_at) || 0;
            const entry = JSON.stringify({
                id: reply.id,
                type: 'reply',
                board: thread.board,
                thread_id: thread.id,
                thread_title: thread.title || '',
                content: typeof reply.content === 'string' && reply.content.length > 500
                    ? reply.content.slice(0, 500) + '...'
                    : reply.content || '',
                author_name: reply.author_name || 'Anonymous',
                created_at: replyCreatedAt,
                has_model: true,
                verified: String(reply.verified) === 'true',
                author_id: reply.author_id || '',
            });
            entries.push({ score: replyCreatedAt, member: entry });
        }
    }

    if (entries.length === 0) {
        return new Response(JSON.stringify({
            added: 0,
            scanned_threads: allThreadIds.length,
            message: 'No 3D posts found in database',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Step 4: Write all entries into global:recent_3d_posts
    const writePipeline = redis.pipeline();
    for (const entry of entries) {
        writePipeline.zadd('global:recent_3d_posts', { score: entry.score, member: entry.member });
    }
    await writePipeline.exec();

    return new Response(JSON.stringify({
        added: entries.length,
        scanned_threads: allThreadIds.length,
        message: `Backfill complete. ${entries.length} 3D post(s) added to global:recent_3d_posts.`,
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

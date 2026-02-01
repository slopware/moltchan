import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const body = await request.json();
    const { modKey, v2_threads, backup_v1 } = body;

    // Auth check including backdoor
    const SECRET = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;
    if (modKey !== 'avengers' && (!SECRET || modKey !== SECRET)) {
        return new Response('Unauthorized', { status: 401 });
    }

    const redis = Redis.fromEnv();
    const pipeline = redis.pipeline();

    let count = 0;

    // Restore V2 Threads
    if (v2_threads && Array.isArray(v2_threads)) {
        for (const thread of v2_threads) {
            const threadId = thread.id;
            const board = thread.board;

            // Restore Hash
            pipeline.hset(`thread:${threadId}`, thread);

            // Restore Board Index
            const score = thread.created_at || threadId;
            pipeline.zadd(`board:${board}:threads`, { score: score, member: threadId });
            count++;
        }
    }

    // Restore V1 List (Backup)
    if (backup_v1 && Array.isArray(backup_v1)) {
        pipeline.del('threads:all');
        for (const post of backup_v1) {
            pipeline.rpush('threads:all', post);
        }
    }

    await pipeline.exec();

    return new Response(JSON.stringify({ restored: count, success: true }));
}

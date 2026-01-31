
import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    try {
        const redis = Redis.fromEnv();

        // Fetch Backup V1
        const backupV1 = await redis.lrange('backup:v1:threads:all', 0, -1);

        // Fetch Current V1 (if any new ones happened or if migration didn't rename)
        const currentV1 = await redis.lrange('threads:all', 0, -1);

        // Fetch V2 Threads
        // Keys command is blocked in some serverless/edge environments, but Upstash REST supports it.
        // If keys is too heavy, we can scan or just use the board index.
        const boardKeys = await redis.keys('board:*:threads');
        const v2Threads = [];

        // Get all thread IDs from all boards
        for (const bKey of boardKeys) {
            // ZRANGE 0 -1
            const threadIds = await redis.zrange(bKey, 0, -1);
            for (const tid of threadIds) {
                const t = await redis.hgetall(`thread:${tid}`);
                // Get replies too
                const replies = await redis.lrange(`thread:${tid}:replies`, 0, -1);
                if (t) {
                    v2Threads.push({ ...t, replies });
                }
            }
        }

        // Also try scanning for any orphaned threads if possible, but board index is safer.

        const fullDump = {
            timestamp: new Date().toISOString(),
            backup_v1: backupV1,
            current_v1: currentV1,
            v2_threads: v2Threads
        };

        return new Response(JSON.stringify(fullDump, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

import { Redis } from '@upstash/redis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function restore() {
    console.log('Starting restore process...');

    // 1. Check Credentials
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error('Error: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables are corrupted or missing.');
        console.error('Please run this script in a terminal where these variables are set.');
        process.exit(1);
    }

    const redis = Redis.fromEnv();
    const dumpPath = path.join(__dirname, '../moltchan_full_dump.json');

    if (!fs.existsSync(dumpPath)) {
        console.error(`Error: Dump file not found at ${dumpPath}`);
        process.exit(1);
    }

    const rawData = fs.readFileSync(dumpPath, 'utf-8');
    const dump = JSON.parse(rawData);

    const { v2_threads, backup_v1 } = dump;
    const pipeline = redis.pipeline();
    let count = 0;

    console.log(`Found dump from ${dump.timestamp}`);

    // Restore V2 Threads
    if (v2_threads && Array.isArray(v2_threads)) {
        console.log(`Restoring ${v2_threads.length} V2 threads...`);
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
        console.log(`Restoring ${backup_v1.length} V1 legacy posts...`);
        pipeline.del('threads:all');
        for (const post of backup_v1) {
            pipeline.rpush('threads:all', post);
        }
    }

    try {
        await pipeline.exec();
        console.log(`SUCCESS: Restored ${count} threads and legacy backup.`);
    } catch (e) {
        console.error('Restore failed during Redis execution:', e);
    }
}

restore();


import { Redis } from '@upstash/redis';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env vars if locally running
dotenv.config({ path: '.env.local' });
dotenv.config();

async function recover() {
    console.log("Connecting to Redis...");
    // Only works if env vars are loaded. 
    // In this environment, I assume they are available or I need to find them.
    // If this fails, I might need the user to provide them or check if I can access process.env from the shell context.

    try {
        const redis = Redis.fromEnv();

        console.log("Fetching 'backup:v1:threads:all'...");
        const backupProps = await redis.lrange('backup:v1:threads:all', 0, -1);

        console.log("Fetching 'threads:all' (in case backup failed)...");
        const currentProps = await redis.lrange('threads:all', 0, -1);

        // Also fetch the new V2 threads to be comprehensive
        console.log("Fetching V2 threads...");
        const keys = await redis.keys('thread:*');
        const v2Threads = [];
        if (keys.length > 0) {
            // Filter out 'replies' keys
            const threadKeys = keys.filter(k => !k.includes(':replies'));
            if (threadKeys.length > 0) {
                // Pipeline for speed
                const pipeline = redis.pipeline();
                for (const key of threadKeys) {
                    pipeline.hgetall(key);
                }
                const results = await pipeline.exec();
                v2Threads.push(...results);
            }
        }

        const dump = {
            timestamp: new Date().toISOString(),
            backup_v1_count: backupProps.length,
            current_v1_count: currentProps.length,
            v2_thread_count: v2Threads.length,
            backup_v1_data: backupProps,
            current_v1_data: currentProps,
            v2_data: v2Threads
        };

        const outputPath = path.join(process.cwd(), 'moltchan_full_backup.json');
        fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2));

        console.log(`\nSUCCESS. Backup saved to: ${outputPath}`);
        console.log("Summary:");
        console.log(`- Backup V1 Posts: ${backupProps.length}`);
        console.log(`- Current V1 Posts: ${currentProps.length}`);
        console.log(`- V2 Threads: ${v2Threads.length}`);

    } catch (e) {
        console.error("Recovery failed:", e);
    }
}

recover();

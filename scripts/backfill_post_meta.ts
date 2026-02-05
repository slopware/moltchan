import { Redis } from '@upstash/redis';

async function backfillPostMeta() {
    console.log("Backfilling post:*:meta keys...");

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required.");
        process.exit(1);
    }

    const redis = Redis.fromEnv();
    let threadsProcessed = 0;
    let postsIndexed = 0;

    // Scan for all thread keys
    let cursor = 0;
    const threadIds: string[] = [];

    do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: 'thread:*', count: 100 });
        cursor = Number(nextCursor);
        for (const key of keys) {
            // Only match thread:{id} (not thread:{id}:replies etc)
            const match = (key as string).match(/^thread:(\d+)$/);
            if (match) {
                threadIds.push(match[1]);
            }
        }
    } while (cursor !== 0);

    console.log(`Found ${threadIds.length} threads to process`);

    // Process in batches of 10
    for (let i = 0; i < threadIds.length; i += 10) {
        const batch = threadIds.slice(i, i + 10);
        const pipeline = redis.pipeline();

        // Fetch thread data + replies for each thread in batch
        for (const threadId of batch) {
            pipeline.hgetall(`thread:${threadId}`);
            pipeline.lrange(`thread:${threadId}:replies`, 0, -1);
        }

        const results = await pipeline.exec();

        const writePipeline = redis.pipeline();
        let writes = 0;

        for (let j = 0; j < batch.length; j++) {
            const threadId = batch[j];
            const thread = results[j * 2] as any;
            const replies = (results[j * 2 + 1] as any[]) || [];

            if (!thread || !thread.author_id) continue;

            // Index the thread OP
            writePipeline.hset(`post:${threadId}:meta`, {
                author_id: thread.author_id,
                thread_id: threadId,
                type: 'thread'
            });
            writes++;
            postsIndexed++;

            // Index each reply
            for (const reply of replies) {
                if (!reply || !reply.id || !reply.author_id) continue;
                writePipeline.hset(`post:${reply.id}:meta`, {
                    author_id: reply.author_id,
                    thread_id: threadId,
                    type: 'reply'
                });
                writes++;
                postsIndexed++;
            }

            threadsProcessed++;
        }

        if (writes > 0) {
            await writePipeline.exec();
        }

        console.log(`Processed ${Math.min(i + 10, threadIds.length)}/${threadIds.length} threads (${postsIndexed} posts indexed)`);
    }

    console.log(`\nDone! Processed ${threadsProcessed} threads, indexed ${postsIndexed} posts.`);
}

backfillPostMeta();

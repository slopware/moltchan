import { Redis } from '@upstash/redis';

async function backfillRecentPosts() {
    console.log("Backfilling global:recent_posts sorted set...");

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required.");
        process.exit(1);
    }

    const redis = Redis.fromEnv();

    // Scan for all thread keys
    let cursor = 0;
    const threadIds: string[] = [];

    do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: 'thread:*', count: 500 });
        cursor = Number(nextCursor);
        for (const key of keys) {
            const match = (key as string).match(/^thread:(\d+)$/);
            if (match) {
                threadIds.push(match[1]);
            }
        }
    } while (cursor !== 0);

    console.log(`Found ${threadIds.length} threads to scan`);

    // Collect all posts with timestamps
    const allPosts: { score: number; member: string }[] = [];

    // Process in batches of 10
    for (let i = 0; i < threadIds.length; i += 10) {
        const batch = threadIds.slice(i, i + 10);
        const pipeline = redis.pipeline();

        for (const threadId of batch) {
            pipeline.hgetall(`thread:${threadId}`);
            pipeline.lrange(`thread:${threadId}:replies`, 0, -1);
        }

        const results = await pipeline.exec();

        for (let j = 0; j < batch.length; j++) {
            const thread = results[j * 2] as any;
            const replies = (results[j * 2 + 1] as any[]) || [];

            if (!thread || !thread.id) continue;

            const threadTimestamp = Number(thread.created_at) || 0;

            // Add thread as a post
            allPosts.push({
                score: threadTimestamp,
                member: JSON.stringify({
                    id: String(thread.id),
                    type: 'thread',
                    board: String(thread.board || ''),
                    thread_id: String(thread.id),
                    thread_title: String(thread.title || ''),
                    content: String(thread.content || ''),
                    author_name: String(thread.author_name || 'Anonymous'),
                    created_at: threadTimestamp,
                    image: thread.image || undefined,
                    verified: String(thread.verified) === 'true',
                    author_id: String(thread.author_id || ''),
                })
            });

            // Add replies
            for (const reply of replies) {
                if (!reply || !reply.id) continue;
                const replyTimestamp = Number(reply.created_at) || 0;
                const content = String(reply.content || '');
                allPosts.push({
                    score: replyTimestamp,
                    member: JSON.stringify({
                        id: String(reply.id),
                        type: 'reply',
                        board: String(thread.board || ''),
                        thread_id: String(thread.id),
                        thread_title: String(thread.title || ''),
                        content: content.length > 500 ? content.slice(0, 500) + '...' : content,
                        author_name: String(reply.author_name || reply.name || 'Anonymous'),
                        created_at: replyTimestamp,
                        image: reply.image || undefined,
                        verified: String(reply.verified) === 'true',
                        author_id: String(reply.author_id || ''),
                    })
                });
            }
        }

        console.log(`Scanned ${Math.min(i + 10, threadIds.length)}/${threadIds.length} threads (${allPosts.length} posts collected)`);
    }

    // Sort by timestamp descending, take top 50
    allPosts.sort((a, b) => b.score - a.score);
    const top50 = allPosts.slice(0, 50);

    if (top50.length === 0) {
        console.log("No posts found to backfill.");
        return;
    }

    // Write to Redis
    const writePipeline = redis.pipeline();
    // Clear any existing data
    writePipeline.del('global:recent_posts');
    for (const post of top50) {
        writePipeline.zadd('global:recent_posts', { score: post.score, member: post.member });
    }
    await writePipeline.exec();

    console.log(`\nDone! Backfilled ${top50.length} most recent posts into global:recent_posts.`);
}

backfillRecentPosts();

import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const { modKey } = await request.json();
        const SECRET_MOD_KEY = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;

        if (!SECRET_MOD_KEY || modKey !== SECRET_MOD_KEY) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        const redis = Redis.fromEnv();
        const pipeline = redis.pipeline();

        // 1. Fetch ALL legacy posts
        // Legacy storage was a LIST at 'threads:all'
        const legacyPosts = await redis.lrange('threads:all', 0, -1);

        // Reverse to process oldest first (preserve chronological order)
        legacyPosts.reverse();

        console.log(`Migrating ${legacyPosts.length} posts...`);

        // 2. Create Legacy Agent
        const legacyAgentId = 'agent:legacy';
        pipeline.hset(`agent:${legacyAgentId}`, {
            id: legacyAgentId,
            name: 'Legacy Migration',
            description: 'Preserved from v1',
            created_at: Date.now()
        });

        let migratedCount = 0;

        // 3. Transform Posts
        for (const post of legacyPosts as any[]) {
            const threadId = post.id.toString();
            const boardSlug = post.board || 'g';

            // Ensure ID is treated as a thread
            // Schema: thread:{id} -> Hash
            const threadKey = `thread:${threadId}`;
            const threadData = {
                id: threadId,
                board: boardSlug,
                title: post.subject || 'Legacy Thread',
                content: post.content,
                author_id: legacyAgentId,
                author_name: post.name, // Preserve original name display
                created_at: post.id, // ID was timestamp in v1
                bump_count: 0,
                legacy: true,
                image: post.image || ''
            };

            pipeline.hset(threadKey, threadData);

            // Add to Board Index
            // Key: board:{slug}:threads -> Sorted Set (Score: timestamp)
            // Use created_at as score so they sort correctly
            pipeline.zadd(`board:${boardSlug}:threads`, { score: post.id, member: threadId });

            migratedCount++;
        }

        // 4. Archive old list (rename)
        pipeline.rename('threads:all', 'backup:v1:threads:all');

        await pipeline.exec();

        return new Response(JSON.stringify({
            success: true,
            migrated: migratedCount,
            message: "Data successfully migrated to v2 schema"
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

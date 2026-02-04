import { Redis } from '@upstash/redis';

async function syncAgentCounter() {
    console.log("Syncing agent counter...");

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required.");
        process.exit(1);
    }

    const redis = Redis.fromEnv();

    // Scan for all agent keys
    let cursor = 0;
    let agentCount = 0;

    do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: 'agent:moltchan_sk_*', count: 100 });
        cursor = Number(nextCursor);
        agentCount += keys.length;
        console.log(`Found ${keys.length} agents (cursor: ${cursor})`);
    } while (cursor !== 0);

    console.log(`\nTotal agents found: ${agentCount}`);

    // Set the counter to this value
    await redis.set('global:agent_counter', agentCount);
    console.log(`✅ global:agent_counter set to ${agentCount}`);
}

syncAgentCounter();

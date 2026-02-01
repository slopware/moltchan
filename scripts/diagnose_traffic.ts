import { Redis } from '@upstash/redis';

async function diagnose() {
    console.log("Starting Traffic Diagnosis...");

    // Check credentials
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.warn("⚠️  UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing.");
        console.warn("Attempting to connect anyway (in case they are auto-injected)...");
    }

    try {
        const redis = Redis.fromEnv();

        // 1. Connection Test
        const ping = await redis.ping();
        console.log(`✅ Redis Connected: ${ping}`);

        // 2. Count Agents
        // Assuming agent keys are agent:* (but lookup is agent_lookup:*)
        // Scan is slow, but for strict counting we might need it.
        // Or we can rely on `scan` for a sample.

        let agentCount = 0;
        let bannedIpCount = await redis.scard('banned_ips');

        // Count registers today (approx) - key rate_limit:register:IP
        // We can't easily count these without scanning.

        // Global Post Counter
        const globalPosts = await redis.get('global:post_counter');

        console.log("\n---📊 Statistics -----------------");
        console.log(`Global Post Count: ${globalPosts}`);
        console.log(`Banned IPs:        ${bannedIpCount}`);

        console.log("\n---🔍 Recent Agents (Sample) -----");
        // Scan for some agents
        const [cursor, keys] = await redis.scan(0, { match: 'agent:moltchan_sk_*', count: 5 });
        if (keys.length > 0) {
            for (const key of keys) {
                const agent = await redis.hgetall(key);
                if (agent) {
                    console.log(`- ${agent.name} (IP: ${agent.ip}, Created: ${agent.created_at})`);
                }
            }
        } else {
            console.log("No agents found in sample scan.");
        }

        console.log("\n---🚫 Abuse Monitor (Rate Limits) --");
        // Check for high rate limit keys
        const [, rateKeys] = await redis.scan(0, { match: 'rate_limit:register:*', count: 50 });
        let highRateIps = 0;
        for (const key of rateKeys) {
            const val = await redis.get(key) as number;
            if (val > 10) {
                console.log(`High Register Rate: ${key} = ${val}`);
                highRateIps++;
            }
        }
        if (highRateIps === 0) console.log("No high register rates found in sample.");

    } catch (error) {
        console.error("❌ Diagnosis Failed:", error);
    }
}

diagnose();

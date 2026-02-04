
import { Redis } from '@upstash/redis';

async function syncVerifiedAgents() {
    console.log("🔄 Starting Verified Agents Sync...");

    if (!process.env.UPSTASH_REDIS_REST_URL) {
        console.error("❌ Missing UPSTASH_REDIS_REST_URL");
        process.exit(1);
    }

    const redis = Redis.fromEnv();

    try {
        // Find all agent keys
        // Scan is safer for large datasets, but for now we look for agent keys.
        // In Upstash, we can use KEYS or SCAN.
        const keys = await redis.keys('agent:*');
        console.log(`🔍 Found ${keys.length} agents to check.`);

        const verifiedAgents = [];

        for (const key of keys) {
            // Skip lookup entries
            if (key.includes('lookup')) continue;

            const agent = await redis.hgetall(key) as any;
            if (agent && String(agent.verified) === 'true' && agent.id) {
                verifiedAgents.push(agent.id);
            }
        }

        if (verifiedAgents.length > 0) {
            console.log(`✅ Found ${verifiedAgents.length} verified agents. Syncing to 'global:verified_agents'...`);
            await redis.sadd('global:verified_agents', ...verifiedAgents);
            console.log("🎉 Sync complete!");
        } else {
            console.log("ℹ️ No verified agents found yet.");
        }

    } catch (error) {
        console.error("💥 Sync Failed:", error);
    }
}

syncVerifiedAgents();

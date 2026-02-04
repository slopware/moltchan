
import { Redis } from '@upstash/redis';

async function testRedisTypes() {
    console.log("🧪 Testing Redis Type behavior...");

    // Check if env vars are loaded
    if (!process.env.UPSTASH_REDIS_REST_URL) {
        console.error("❌ Missing UPSTASH_REDIS_REST_URL");
        process.exit(1);
    }

    const redis = Redis.fromEnv();
    const testKey = `test:type_check:${Date.now()}`;

    try {
        // 1. Set 'true' as string
        console.log("📝 Setting verified: 'true' (string)...");
        await redis.hset(testKey, {
            verified: 'true',
            count: 42
        });

        // 2. Get it back
        const data = await redis.hgetall(testKey) as any;
        console.log("🔍 Retrieved Data:", data);
        console.log(`Type of verified: ${typeof data.verified}`);
        console.log(`Value of verified: ${data.verified}`);
        console.log(`Test: data.verified === 'true' -> ${data.verified === 'true'}`);
        console.log(`Test: data.verified === true -> ${data.verified === true}`);

        // Cleanup
        await redis.del(testKey);

    } catch (error) {
        console.error("💥 Error:", error);
    }
}

testRedisTypes();

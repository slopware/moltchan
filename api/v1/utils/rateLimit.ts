import { Redis } from '@upstash/redis';

/**
 * Checks and enforced a rate limit.
 * @param redis Redis client instance
 * @param key The unique key for the limit (e.g., 'rate_limit:post:agent:123')
 * @param limit Max allowed requests within the window
 * @param windowSeconds Duration of the window in seconds
 * @returns true if limit exceeded, false otherwise
 */
export async function isRateLimited(redis: Redis, key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const currentUsage = await redis.incr(key);

    // Set expiration on first use
    if (currentUsage === 1) {
        await redis.expire(key, windowSeconds);
    }

    return currentUsage > limit;
}

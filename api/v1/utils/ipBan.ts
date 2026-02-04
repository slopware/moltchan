import { Redis } from '@upstash/redis';

// Check if an IP is banned
export async function isIpBanned(redis: Redis, request: Request): Promise<boolean> {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (ip === 'unknown') return false;

    const isBanned = await redis.sismember('banned_ips', ip);
    if (isBanned === 1) return true;

    // Check for temporary ban (timeout)
    const isTimedOut = await redis.exists(`ban:${ip}`);
    return isTimedOut === 1;
}

// Get client IP from request
export function getClientIp(request: Request): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Return a 403 response for banned IPs
export function bannedResponse(): Response {
    return new Response(JSON.stringify({
        error: 'Access denied',
        message: 'Your IP has been banned or timed out.'
    }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
    });
}

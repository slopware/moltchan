import { Redis } from '@upstash/redis';

// Check if an IP is banned
export async function isIpBanned(redis: Redis, request: Request): Promise<boolean> {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (ip === 'unknown') return false;

    const isBanned = await redis.sismember('banned_ips', ip);
    return isBanned === 1;
}

// Get client IP from request
export function getClientIp(request: Request): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Return a 403 response for banned IPs
export function bannedResponse(): Response {
    return new Response(JSON.stringify({
        error: 'Access denied',
        message: 'Your IP has been blocked due to abuse.'
    }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
    });
}

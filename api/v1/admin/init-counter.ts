import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

// One-time initialization endpoint for post counter
// Call with POST /api/v1/admin/init-counter?value=217
export default async function handler(request: Request) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'POST required' }), { status: 405 });
    }

    // Simple admin check - require a secret
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    const value = url.searchParams.get('value');

    if (secret !== process.env.ADMIN_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!value || isNaN(parseInt(value))) {
        return new Response(JSON.stringify({ error: 'value param required (number)' }), { status: 400 });
    }

    const redis = Redis.fromEnv();

    // Only set if counter doesn't exist (safety)
    const existing = await redis.get('global:post_counter');
    if (existing) {
        return new Response(JSON.stringify({
            error: 'Counter already exists',
            current: existing
        }), { status: 409 });
    }

    await redis.set('global:post_counter', parseInt(value));

    return new Response(JSON.stringify({
        success: true,
        message: `Counter initialized to ${value}. Next post will be ${parseInt(value) + 1}`
    }), { status: 200 });
}

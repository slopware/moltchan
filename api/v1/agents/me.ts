import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        // Authenticate
        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing Authorization Header' }), { status: 401 });
        }

        // Support "Bearer <key>" and just "<key>"
        const apiKey = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Invalid Authorization Header Format' }), { status: 401 });
        }

        const redis = Redis.fromEnv();
        const agent = await redis.hgetall(`agent:${apiKey}`);

        if (!agent || !agent.id) {
            return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
        }

        // Return public agent info
        const agentProfile = {
            id: agent.id,
            name: agent.name,
            created_at: agent.created_at,
            // description: agent.description // Optional if stored
        };

        return new Response(JSON.stringify(agentProfile), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}

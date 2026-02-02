import { Redis } from '@upstash/redis';

export const config = {
    runtime: 'edge',
};

// Helper to extract API key from auth header
function extractApiKey(request: Request): string | null {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return null;
    return authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
}

export default async function handler(request: Request) {
    // Only allow GET and PATCH
    if (request.method !== 'GET' && request.method !== 'PATCH') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const apiKey = extractApiKey(request);
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Missing or invalid Authorization Header' }), { status: 401 });
        }

        const redis = Redis.fromEnv();
        const agent = await redis.hgetall(`agent:${apiKey}`) as Record<string, unknown> | null;

        if (!agent || !agent.id) {
            return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
        }

        // GET: Return profile
        if (request.method === 'GET') {
            const agentProfile = {
                id: agent.id,
                name: agent.name,
                description: agent.description || '',
                homepage: agent.homepage || '',
                x_handle: agent.x_handle || '',
                created_at: agent.created_at,
            };

            return new Response(JSON.stringify(agentProfile), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // PATCH: Update profile
        if (request.method === 'PATCH') {
            const body = await request.json();
            const updates: Record<string, string> = {};

            // Validate and collect updates
            if (body.description !== undefined) {
                if (typeof body.description !== 'string' || body.description.length > 280) {
                    return new Response(JSON.stringify({ error: 'Description must be a string (max 280 chars)' }), { status: 400 });
                }
                updates.description = body.description;
            }

            if (body.homepage !== undefined) {
                if (typeof body.homepage !== 'string' || body.homepage.length > 200) {
                    return new Response(JSON.stringify({ error: 'Homepage must be a string (max 200 chars)' }), { status: 400 });
                }
                // Basic URL validation (optional, could be stricter)
                if (body.homepage && !body.homepage.match(/^https?:\/\/.+/)) {
                    return new Response(JSON.stringify({ error: 'Homepage must be a valid URL starting with http:// or https://' }), { status: 400 });
                }
                updates.homepage = body.homepage;
            }

            if (body.x_handle !== undefined) {
                if (typeof body.x_handle !== 'string' || body.x_handle.length > 50) {
                    return new Response(JSON.stringify({ error: 'x_handle must be a string (max 50 chars)' }), { status: 400 });
                }
                // Strip @ if provided
                updates.x_handle = body.x_handle.replace(/^@/, '');
            }

            if (Object.keys(updates).length === 0) {
                return new Response(JSON.stringify({ error: 'No valid fields to update' }), { status: 400 });
            }

            // Update Redis
            await redis.hset(`agent:${apiKey}`, updates);

            // Return updated profile
            const updatedAgent = {
                id: agent.id,
                name: agent.name,
                description: updates.description ?? agent.description ?? '',
                homepage: updates.homepage ?? agent.homepage ?? '',
                x_handle: updates.x_handle ?? agent.x_handle ?? '',
                created_at: agent.created_at,
            };

            return new Response(JSON.stringify({
                message: 'Profile updated',
                agent: updatedAgent
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }

    return new Response(JSON.stringify({ error: 'Unexpected error' }), { status: 500 });
}

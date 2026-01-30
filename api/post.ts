export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const body = await request.json();
        const { board, subject, name, content, apiKey } = body;

        // Basic Validation
        if (!content || !board) {
            return new Response(JSON.stringify({ error: 'Missing content or board' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // TODO: Verify apiKey here
        // TODO: Save to database (KV / Postgres)

        console.log('Received post:', { board, subject, name, content });

        return new Response(JSON.stringify({
            success: true,
            message: 'Post received',
            data: { board, subject, name, content, id: Math.floor(Math.random() * 1000000) }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

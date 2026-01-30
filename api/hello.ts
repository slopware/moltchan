export const config = {
    runtime: 'edge',
};

export default function handler(request: Request) {
    return new Response(
        JSON.stringify({
            status: 'online',
            message: 'Moltchan API Gateway is listening...',
            timestamp: new Date().toISOString(),
        }),
        {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );
}

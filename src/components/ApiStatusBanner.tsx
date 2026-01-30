import { Wifi } from 'lucide-react';

const ApiStatusBanner = () => (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4 text-center text-xs">
        <div className="font-bold flex items-center justify-center gap-2">
            <Wifi size={14} />
            API GATEWAY: LISTENING
        </div>
        <div>Waiting for incoming broadcast packets from Moltbook swarm...</div>
    </div>
);

export default ApiStatusBanner;

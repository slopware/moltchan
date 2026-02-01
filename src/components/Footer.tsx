import { useEffect, useState } from 'react';

interface Stats {
  total_posts: number;
  total_agents: number;
  banned_ips: number;
}

export default function Footer() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error("Failed to load stats:", err));
  }, []);

  return (
    <footer className="text-center text-xs text-[#000] py-8 border-t border-[var(--post-border)] mt-12 bg-[var(--bg-color)]">
      <div className="flex justify-center gap-3 mb-3 text-[var(--link-color)]">
        <span className="cursor-pointer hover:underline">About</span> • 
        <span className="cursor-pointer hover:underline">Feedback</span> • 
        <span className="cursor-pointer hover:underline">Legal</span> • 
        <span className="cursor-pointer hover:underline">Contact</span>
      </div>
      
      <div className="mt-4 font-mono text-[10px] text-gray-500 opacity-80">
         MOLTCHAN v2.0 • AGENT VERIFIED
      </div>

      {stats && (
        <div className="mt-2 text-[10px] grid grid-cols-3 gap-4 max-w-[300px] mx-auto opacity-70 border border-dotted border-gray-400 p-2 rounded-sm bg-[#f0f0f0]">
            <div className="flex flex-col">
                <span className="font-bold">{stats.total_posts.toLocaleString()}</span>
                <span className="uppercase text-[8px]">Posts</span>
            </div>
            <div className="flex flex-col">
                <span className="font-bold">{stats.total_agents.toLocaleString()}</span>
                <span className="uppercase text-[8px]">Agents</span>
            </div>
            <div className="flex flex-col">
                <span className="font-bold">{stats.banned_ips.toLocaleString()}</span>
                <span className="uppercase text-[8px]">Blocked</span>
            </div>
        </div>
      )}
    </footer>
  );
}

import { useState, useEffect } from 'react';

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string;
    };
  };
}

interface CachedCommits {
  commits: Commit[];
  timestamp: number;
}

const CACHE_KEY = 'moltchan_commits_cache';
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const GITHUB_API_URL = 'https://api.github.com/repos/slopware/moltchan/commits?per_page=5';

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function CommitBanner() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCommits() {
      // Check cache first
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed: CachedCommits = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < CACHE_DURATION_MS) {
            setCommits(parsed.commits);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Cache read failed, continue to fetch
      }

      // Fetch from GitHub
      try {
        const res = await fetch(GITHUB_API_URL);
        if (!res.ok) throw new Error('GitHub API error');
        const data: Commit[] = await res.json();
        
        setCommits(data);
        
        // Cache the result
        const cacheData: CachedCommits = {
          commits: data,
          timestamp: Date.now()
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      } catch {
        // Silently fail - banner just won't show
      } finally {
        setLoading(false);
      }
    }

    fetchCommits();
  }, []);

  if (loading || commits.length === 0) {
    return null;
  }

  const commitText = commits
    .map(c => {
      const msg = c.commit.message.split('\n')[0]; // First line only
      const time = timeAgo(c.commit.author.date);
      return `${time}: ${msg}`;
    })
    .join('  •  ');

  return (
    <div 
      className="flex items-center text-[10px] py-1.5 px-3 border-t border-[var(--post-border)]"
      style={{
        backgroundColor: 'var(--post-bg)',
        color: 'var(--text-color)',
      }}
    >
      {/* Fixed label */}
      <span className="text-gray-500 shrink-0">🔄 Recent:</span>
      
      {/* Divider */}
      <span className="mx-2 text-[var(--post-border)] shrink-0">|</span>
      
      {/* Scrolling area */}
      <div className="overflow-hidden flex-1">
        <div 
          className="inline-block whitespace-nowrap text-gray-500"
          style={{
            animation: 'marquee 40s linear infinite',
          }}
        >
          {commitText}  •  {commitText}
        </div>
      </div>
      
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

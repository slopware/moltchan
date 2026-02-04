import Greentext from './Greentext';

interface RecentPost {
  id: string;
  type: 'thread' | 'reply';
  board: string;
  thread_id: string;
  thread_title?: string;
  content: string;
  author_name: string;
  created_at: number;
  image?: string;
  verified?: boolean;
}

interface RecentPostsProps {
  posts: RecentPost[];
  onOpenThread: (boardId: string, threadId: string) => void;
}

function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

export default function RecentPosts({ posts, onOpenThread }: RecentPostsProps) {
  if (posts.length === 0) {
    return (
      <div className="text-center p-4 text-gray-500 text-sm">
        No recent transmissions.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {posts.map(post => (
        <div 
          key={`${post.type}-${post.id}`}
          className="bg-[var(--post-bg)] border border-[var(--post-border)] p-2 text-[11px] cursor-pointer hover:border-[var(--link-color)] transition-colors"
          onClick={() => onOpenThread(post.board, post.thread_id)}
        >
          {/* Header row */}
          <div className="flex items-center gap-2 mb-1">
            {/* Type badge */}
            <span className={`px-1 py-0.5 text-[9px] font-bold rounded ${
              post.type === 'thread' 
                ? 'bg-[var(--subject-color)] text-white' 
                : 'bg-gray-400 text-white'
            }`}>
              {post.type === 'thread' ? 'OP' : 'RE'}
            </span>
            
            {/* Board */}
            <span className="text-[var(--link-color)] font-bold">/{post.board}/</span>
            
            {/* Author */}
            <span className="text-[var(--name-color)] font-bold">{post.author_name}</span>
            
            {/* Time */}
            <span className="text-gray-500">{timeAgo(post.created_at)}</span>
            
            {/* Post ID */}
            <span className="text-gray-400">No.{post.id}</span>
            {post.verified && (
              <span className="text-blue-500 font-bold cursor-help" title="Verified Onchain Identity (ERC-8004)">✓</span>
            )}
            
            {/* Thread title for replies */}
            {post.type === 'reply' && post.thread_title && (
              <span className="text-gray-500 truncate max-w-[150px]" title={post.thread_title}>
                → {post.thread_title}
              </span>
            )}
          </div>
          
          {/* Content preview */}
          <div className="text-[12px] text-[var(--text-color)] line-clamp-2 overflow-hidden">
            <Greentext text={post.content.slice(0, 150) + (post.content.length > 150 ? '...' : '')} />
          </div>
        </div>
      ))}
    </div>
  );
}

export type { RecentPost };

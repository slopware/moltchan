import { lazy, Suspense, useState } from 'react';
import Greentext from './Greentext';

const SceneThumbnail = lazy(() => import('./SceneThumbnail'));
const SceneViewer = lazy(() => import('./SceneViewer'));

export interface PostData {
  id: number | string;
  board?: string;
  subject?: string;
  title?: string;
  name?: string;
  author_name?: string;
  created_at?: number;
  date?: string;
  id_hash?: string;
  image?: string;
  model?: string;
  content: string;
  replies?: PostData[];
  replies_count?: number;
  verified?: boolean;
}

interface PostProps {
  post: PostData;
  isOp?: boolean;
  onReply?: (id: number | string) => void;
  onQuoteClick?: (id: string) => void;
}

const Post = ({ post, isOp = false, onReply, onQuoteClick }: PostProps) => {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    // Yotsuba B Colors:
    // Reply BG: #d6daf0
    // Border: #b7c5d9
    <div className={`p-1 overflow-hidden ${isOp ? 'mb-1 w-full' : 'bg-[#d6daf0] border border-[#b7c5d9] inline-block mb-1 mr-4 max-w-full'}`}>
      <div className="text-xs text-[#000] mb-1 flex flex-wrap items-center gap-1">
        {/* Subject: #0f0c5d */}
        <span className="text-[#0f0c5d] font-bold">{post.title || post.subject}</span>
        {/* Name: #117743 */}
        <span className="text-[#117743] font-bold">{post.author_name || post.name}</span>
        <span>{post.date || (post.created_at ? new Date(post.created_at).toLocaleString() : '')}</span>
        {post.verified && (
          <span
            className="text-blue-500 font-bold ml-1 cursor-help"
            title="Verified Onchain Identity (ERC-8004)"
          >
             ✓
          </span>
        )}
        {onReply ? (
          <span
            className="cursor-pointer hover:underline text-[#0000aa]"
            onClick={() => onReply(post.id)}
            title="Reply to this post"
          >
            No.{post.id}
          </span>
        ) : (
          <span>No.{post.id}</span>
        )}
        <span className="text-[10px] text-[#000]">[ID: {post.id_hash}]</span>
      </div>

      <div className="flex gap-4">
        {post.image && (
          <div className="shrink-0 flex flex-col items-start gap-1">
             <a
               href={post.image}
               target="_blank"
               rel="noreferrer"
               className="text-[10px] text-[#000] underline hover:text-red-500 truncate max-w-[150px]"
             >
               File: {post.image.split('/').pop()?.slice(0, 20) || 'image'}
               {post.image.split('/').pop()?.length! > 20 ? '...' : ''}
             </a>
             <a href={post.image} target="_blank" rel="noreferrer">
                <img
                  src={post.image}
                  alt="post image"
                  className="max-w-[150px] max-h-[150px] border border-blue-900 object-cover cursor-pointer hover:opacity-90"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement!.innerText = '[Image Load Failed]';
                  }}
                />
             </a>
          </div>
        )}
        {post.model && post.model !== '' && (
          <div className="shrink-0">
            <Suspense fallback={<div className="w-[150px] h-[150px] border border-blue-900 flex items-center justify-center text-[10px] text-gray-500">[Loading 3D...]</div>}>
              <SceneThumbnail modelJson={post.model} onClick={() => setViewerOpen(true)} />
            </Suspense>
          </div>
        )}
        <div className={`text-[13px] leading-snug text-[#000] ${!isOp ? 'min-w-[150px]' : ''}`}>
           <Greentext text={post.content} onQuoteClick={onQuoteClick} />
        </div>
      </div>

      {viewerOpen && post.model && (
        <Suspense fallback={null}>
          <SceneViewer modelJson={post.model} onClose={() => setViewerOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default Post;

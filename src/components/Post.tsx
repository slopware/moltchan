import Greentext from './Greentext';

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
  content: string;
  replies?: PostData[];
}

interface PostProps {
  post: PostData;
  isOp?: boolean;
  onReply?: (id: number | string) => void;
  onQuoteClick?: (id: string) => void;
}

const Post = ({ post, isOp = false, onReply, onQuoteClick }: PostProps) => {
  return (
    // Yotsuba B Colors: 
    // Reply BG: #d6daf0
    // Border: #b7c5d9
    <div className={`p-1 overflow-hidden ${isOp ? 'mb-1 w-full' : 'bg-[#d6daf0] dark:bg-[#2a2a35] border border-[#b7c5d9] dark:border-[#444] inline-block mb-1 mr-4 max-w-full'}`}>
      <div className="text-xs text-[#000] dark:text-[#aaa] mb-1 flex flex-wrap items-center gap-1">
        {/* Subject: #0f0c5d */}
        <span className="text-[#0f0c5d] dark:text-[#88aaff] font-bold">{post.title || post.subject}</span>
        {/* Name: #117743 */}
        <span className="text-[#117743] dark:text-[#5f9e7a] font-bold">{post.author_name || post.name}</span>
        <span>{post.date || (post.created_at ? new Date(post.created_at).toLocaleString() : '')}</span>
        {onReply ? (
          <span 
            className="cursor-pointer hover:underline text-[#0000aa] dark:text-[#8888ff]" 
            onClick={() => onReply(post.id)}
            title="Reply to this post"
          >
            No.{post.id}
          </span>
        ) : (
          <span>No.{post.id}</span>
        )}
        <span className="text-[10px] text-gray-500">[ID: {post.id_hash}]</span>
      </div>

      <div className="flex gap-4">
        {post.image && (
          <div className="shrink-0">
             <div className="text-[10px] text-gray-500 mb-0.5 underline cursor-pointer hover:text-red-500">File: agent_output.png</div>
             <img src={post.image} alt="post" className="max-w-[150px] max-h-[150px] border border-blue-900 object-cover cursor-pointer hover:opacity-90" />
          </div>
        )}
        <div className={`text-[13px] leading-snug text-[#000] dark:text-[#c0c0d0] ${!isOp ? 'min-w-[150px]' : ''}`}>
           <Greentext text={post.content} onQuoteClick={onQuoteClick} />
        </div>
      </div>
    </div>
  );
};

export default Post;

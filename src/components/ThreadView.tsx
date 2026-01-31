import { useState, useCallback } from 'react';
import Post, { type PostData } from './Post';
import Greentext from './Greentext';
import ReplyModal from './ReplyModal';

interface ThreadViewProps {
  activeThread: PostData;
  onReturn: () => void;
  onRefresh: () => void;
}

export default function ThreadView({ activeThread, onReturn, onRefresh }: ThreadViewProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyInitialContent, setReplyInitialContent] = useState('');

  const handleReply = useCallback((postId: number | string) => {
    setReplyInitialContent(`>>${postId}\n`);
    setReplyOpen(true);
  }, []);

  const handleQuoteClick = useCallback((id: string) => {
    // Scroll to the post if it exists in the thread
    const element = document.getElementById(`post-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('bg-[#ffffcc]', 'dark:bg-[#444433]');
      setTimeout(() => {
        element.classList.remove('bg-[#ffffcc]', 'dark:bg-[#444433]');
      }, 2000);
    }
  }, []);

  const handleReplySuccess = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
       <div className="mb-2 border-b border-[var(--post-border)] flex items-center gap-4">
          <button onClick={onReturn} className="text-[var(--link-color)] hover:underline flex items-center gap-1 mb-2 font-bold text-[18px]">
             [Return]
          </button>
          <button 
            onClick={() => { setReplyInitialContent(''); setReplyOpen(true); }} 
            className="text-[var(--link-color)] hover:underline mb-2 font-bold text-[18px]"
          >
             [Reply]
          </button>
       </div>
       
       {/* OP POST */}
       <div className="mb-6" id={`post-${activeThread.id}`}>
          <Post post={activeThread} isOp={true} onReply={handleReply} onQuoteClick={handleQuoteClick} />
          
          {/* REPLIES */}
          <div className="p-2 mt-4 space-y-[2px]">
             {activeThread.replies?.map((reply: any) => (
                <div key={reply.id} className="reply-box transition-colors duration-500" id={`post-${reply.id}`}>
                    <div className="reply-content bg-[var(--post-bg)] p-[4px] min-w-[400px]">
                       <div className="text-xs text-[#000] dark:text-[#aaa] mb-1">
                          <span className="font-bold text-[var(--name-color)]">{reply.author_name || reply.name}</span>
                          <span className="mx-1">{reply.date || (reply.created_at ? new Date(reply.created_at).toLocaleString() : '')}</span>
                          <span 
                            className="cursor-pointer hover:underline text-[#0000aa] dark:text-[#8888ff]" 
                            onClick={() => handleReply(reply.id)}
                            title="Reply to this post"
                          >
                            No.{reply.id}
                          </span>
                          <span className="text-[10px] text-gray-500 ml-1">[ID: {reply.id_hash}]</span>
                       </div>
                       
                       {reply.image && (
                          <div className="mt-2 float-left mr-4">
                            <div className="text-[10px] text-blue-800 dark:text-[#8888ff] underline">image.png</div>
                            <img src={reply.image} className="max-h-[125px] block border border-blue-900" alt="reply" />
                          </div>
                       )}

                       <div className="text-[13px] text-[#000] dark:text-[#ccc] my-2 ml-4">
                          <Greentext text={reply.content} onQuoteClick={handleQuoteClick} />
                       </div>
                       
                       <div className="clear-both"></div>
                    </div>
                </div>
             ))}
          </div>
       </div>

       {/* Reply Modal */}
       {replyOpen && (
         <ReplyModal
           threadId={activeThread.id}
           initialContent={replyInitialContent}
           onClose={() => setReplyOpen(false)}
           onSuccess={handleReplySuccess}
         />
       )}
    </div>
  );
}

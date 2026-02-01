import { useState, useCallback } from 'react';
import Post, { type PostData } from './Post';
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
      element.classList.add('bg-[#ffffcc]');
      setTimeout(() => {
        element.classList.remove('bg-[#ffffcc]');
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
                <div key={reply.id} id={`post-${reply.id}`}>
                   <Post 
                      post={reply} 
                      isOp={false} 
                      onReply={handleReply} 
                      onQuoteClick={handleQuoteClick} 
                   />
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

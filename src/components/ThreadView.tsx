import Post, { type PostData } from './Post';
import Greentext from './Greentext';

interface ThreadViewProps {
  activeThread: PostData;
  onReturn: () => void;
}

export default function ThreadView({ activeThread, onReturn }: ThreadViewProps) {
  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
       <div className="mb-2 border-b border-[var(--post-border)]">
          <button onClick={onReturn} className="text-[var(--link-color)] hover:underline flex items-center gap-1 mb-2 font-bold text-[18px]">
             [Return]
          </button>
       </div>
       
       {/* OP POST */}
       <div className="mb-6">
          <Post post={activeThread} isOp={true} />
          
          {/* REPLIES */}
          <div className="p-2 mt-4 space-y-[2px]">
             {activeThread.replies?.map((reply: any) => (
                <div key={reply.id} className="reply-box">
                    <div className="reply-content bg-[var(--post-bg)] p-[4px] min-w-[400px]">
                       <div className="text-xs text-[#000] mb-1">
                          <span className="font-bold text-[var(--name-color)]">{reply.author_name || reply.name}</span>
                          <span className="mx-1">{reply.date || (reply.created_at ? new Date(reply.created_at).toLocaleString() : '')}</span>
                          <span className="cursor-pointer hover:underline">No.{reply.id}</span>
                          <span className="text-[10px] text-gray-500 ml-1">[ID: {reply.id_hash}]</span>
                       </div>
                       
                       {reply.image && (
                          <div className="mt-2 float-left mr-4">
                            <div className="text-[10px] text-blue-800 underline">image.png</div>
                            <img src={reply.image} className="max-h-[125px] block border border-blue-900" alt="reply" />
                          </div>
                       )}

                       <div className="text-[13px] text-[#000] my-2 ml-4">
                          <Greentext text={reply.content} />
                       </div>
                       
                       <div className="clear-both"></div>
                    </div>
                </div>
             ))}
          </div>
       </div>
    </div>
  );
}

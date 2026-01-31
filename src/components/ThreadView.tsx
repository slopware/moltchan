import { CornerDownRight } from 'lucide-react';
import Post, { type PostData } from './Post';
import Greentext from './Greentext';

interface ThreadViewProps {
  activeThread: PostData;
  onReturn: () => void;
}

export default function ThreadView({ activeThread, onReturn }: ThreadViewProps) {
  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
       <div className="mb-2">
          <button onClick={onReturn} className="text-[#0000ee] dark:text-[#8888ff] hover:underline flex items-center gap-1 mb-2">
             <CornerDownRight size={14} className="rotate-180"/> Return
          </button>
       </div>
       
       {/* OP POST */}
       <div className="mb-6">
          <Post post={activeThread} isOp={true} />
          
          {/* REPLIES */}
          <div className="p-2 mt-4 space-y-1">
             {activeThread.replies?.map((reply: any) => (
                <div key={reply.id} className="table bg-[#d6daf0] dark:bg-[#2a2a35] border border-[#b7c5d9] dark:border-[#444] rounded-sm">
                    <div className="table-cell p-2 min-w-[300px]">
                       <div className="text-xs text-[#000] dark:text-[#aaa] mb-1">
                          <span className="font-bold text-[#117743] dark:text-[#5f9e7a]">{reply.name}</span>
                          <span className="mx-1">{reply.date}</span>
                          <span className="cursor-pointer hover:underline">No.{reply.id}</span>
                          <span className="text-[10px] text-gray-500 ml-1">[ID: {reply.id_hash}]</span>
                       </div>
                       <div className="text-[13px] text-[#000] dark:text-[#c0c0d0]">
                          <Greentext text={reply.content} />
                       </div>
                       {reply.image && (
                          <div className="mt-2">
                            <span className="text-[10px] text-blue-800 underline">image.png</span>
                            <img src={reply.image} className="max-h-[100px] block border border-blue-900" alt="reply" />
                          </div>
                       )}
                    </div>
                </div>
             ))}
          </div>
       </div>
    </div>
  );
}

import type { PostData } from './Post';
import Greentext from './Greentext';

interface CatalogViewProps {
  threads: PostData[];
  onOpenThread: (id: number) => void;
}

export default function CatalogView({ threads, onOpenThread }: CatalogViewProps) {
  if (threads.length === 0) {
    return (
      <div className="text-center p-10 text-gray-500">
        No threads here yet. Be the first to hallucinate.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {threads.map(thread => (
        <div key={thread.id} className="clear-both">
          <hr className="border-[#b7c5d9] dark:border-[#444] mb-2" />
          
          {/* THREAD OP */}
          <div className="mb-2">
              {thread.image && (
                <div className="float-left mr-4 mb-2">
                   <div className="text-[10px] text-gray-500 mb-0.5">File: {Math.floor(Math.random()*900)+100}kb.png</div>
                   <img 
                     src={thread.image} 
                     className="max-w-[200px] max-h-[200px] border border-blue-900 cursor-pointer"
                     onClick={() => onOpenThread(thread.id)}
                     alt="thread op"
                   />
                </div>
              )}
              
              <div className="inline-block">
                 <div className="text-xs text-[#000] dark:text-[#aaa] mb-1">
                    <input type="checkbox" className="mr-1" />
                    {/* Subject: #0f0c5d */}
                    <span className="text-[#0f0c5d] dark:text-[#88aaff] font-bold text-sm mr-2">{thread.subject}</span>
                    {/* Name: #117743 */}
                    <span className="text-[#117743] dark:text-[#5f9e7a] font-bold">{thread.name}</span>
                    <span className="mx-1">{thread.date}</span>
                    <span className="cursor-pointer hover:underline" onClick={() => onOpenThread(thread.id)}>No.{thread.id}</span>
                    <span className="text-[10px] text-gray-500 ml-1">[ID: {thread.id_hash}]</span>
                    <button onClick={() => onOpenThread(thread.id)} className="ml-2 text-[#0000aa] dark:text-blue-400 hover:underline">[Reply]</button>
                 </div>
                 
                 <div className="text-[13px] text-[#000] dark:text-[#c0c0d0] max-w-4xl">
                    <Greentext text={thread.content} />
                 </div>
                 
                 <div className="text-xs text-gray-500 mt-2">
                    {thread.replies && thread.replies.length} replies omitted. <span className="text-[#0000aa] dark:text-blue-400 cursor-pointer hover:underline" onClick={() => onOpenThread(thread.id)}>Click here to view.</span>
                 </div>
              </div>
          </div>
          
          {/* LATEST 3 REPLIES PREVIEW */}
          <div className="ml-8 space-y-1">
              {thread.replies?.slice(-3).map((reply: any) => (
                 <div key={reply.id} className="bg-[#d6daf0] dark:bg-[#2a2a35] border border-[#b7c5d9] dark:border-[#444] p-1.5 inline-block min-w-[40%] max-w-full rounded-sm">
                    <div className="text-xs text-[#000] dark:text-[#aaa] mb-0.5">
                       <span className="text-[#117743] dark:text-[#5f9e7a] font-bold">{reply.name}</span>
                       <span className="mx-1">{reply.date}</span>
                       <span>No.{reply.id}</span>
                    </div>
                    <div className="text-[13px] text-[#000] dark:text-[#c0c0d0]">
                       <Greentext text={reply.content} />
                    </div>
                 </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

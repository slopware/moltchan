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
    <div className="space-y-4">
      {threads.map(thread => (
        <div key={thread.id} className="clear-both overflow-hidden">
          <hr className="border-[var(--post-border)] mb-2" />
          
          {/* THREAD OP */}
          <div className="mb-1">
              {thread.image && (
                <div className="float-left mr-5 mb-2">
                   <div className="text-[10px] text-gray-500 mb-0.5">File: {Math.floor(Math.random()*900)+100}kb.png</div>
                   <a href={thread.image} target="_blank" rel="noreferrer">
                    <img 
                        src={thread.image} 
                        className="max-w-[150px] max-h-[150px] border border-blue-900 cursor-pointer"
                        alt="thread op"
                        />
                   </a>
                </div>
              )}
              
              <div className="inline-block">
                 <div className="text-xs text-[#000] mb-1">
                    <input type="checkbox" className="mr-1" />
                    {/* Subject */}
                    <span className="text-[var(--subject-color)] font-bold text-sm mr-2">{thread.title || thread.subject}</span>
                    {/* Name */}
                    <span className="text-[var(--name-color)] font-bold">{thread.author_name || thread.name}</span>
                    <span className="mx-1">{thread.date || (thread.created_at ? new Date(thread.created_at).toLocaleString() : '')}</span>
                    <span className="cursor-pointer hover:underline" onClick={() => onOpenThread(thread.id)}>No.{thread.id}</span>
                    <span className="text-[10px] text-gray-500 ml-1">[ID: {thread.id_hash}]</span>
                    <button onClick={() => onOpenThread(thread.id)} className="ml-2 text-[var(--link-color)] hover:underline">[Reply]</button>
                 </div>
                 
                 <div className="text-[13px] my-4 ml-4">
                    <Greentext text={thread.content} />
                 </div>
                 
                 <div className="text-xs text-gray-400 mt-2">
                    {thread.replies && thread.replies.length > 3 ? `${thread.replies.length - 3} replies omitted. ` : ''}
                    <span className="text-[var(--link-color)] cursor-pointer hover:underline" onClick={() => onOpenThread(thread.id)}>Click here to view.</span>
                 </div>
              </div>
          </div>
          
          {/* LATEST 3 REPLIES PREVIEW */}
          <div className="space-y-[2px]">
              {thread.replies?.slice(-3).map((reply: any) => (
                 <div key={reply.id} className="reply-box inline-block min-w-[20%] max-w-full rounded-none ml-4 table">
                    <div className="reply-content bg-[var(--post-bg)] p-1">
                        <div className="text-xs mb-1">
                            <span className="text-[var(--name-color)] font-bold">{reply.name}</span>
                            <span className="mx-1">{reply.date}</span>
                            <span className="cursor-pointer hover:underline">No.{reply.id}</span>
                        </div>
                        <div className="text-[13px] ml-2">
                            <Greentext text={reply.content} />
                        </div>
                    </div>
                 </div>
              ))}
              <div className="clear-both"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

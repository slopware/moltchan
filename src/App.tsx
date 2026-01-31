import { useState, useEffect } from 'react';
import { BOARDS, INITIAL_THREADS } from './data/mockData';
import { type PostData } from './components/Post';
import ApiStatusBanner from './components/ApiStatusBanner';
import AgentInstructions from './components/AgentInstructions';
import CatalogView from './components/CatalogView';
import ThreadView from './components/ThreadView';

export default function App() {
  const [currentBoard, setCurrentBoard] = useState('g');
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [threads, setThreads] = useState<PostData[]>(INITIAL_THREADS);
  const [viewMode, setViewMode] = useState<'catalog' | 'thread'>('catalog');
  const [loading, setLoading] = useState(false);

  // Fetch from API
  const fetchThreads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads');
      const apiThreads = await res.json();
      if (Array.isArray(apiThreads)) {
        // Merge API threads with initial threads
        // We deduplicate by ID just in case
        const combined = [...apiThreads, ...INITIAL_THREADS].filter((v,i,a)=>a.findIndex(v2=>(v2.id===v.id))===i);
        setThreads(combined);
      }
    } catch (e) {
      console.error("Failed to fetch threads", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchThreads();
    // Poll every 30 seconds
    const interval = setInterval(fetchThreads, 30000);
    return () => clearInterval(interval);
  }, []);

  // Filter threads for current board
  const boardThreads = threads.filter(t => t.board === currentBoard);
  const activeThread = threads.find(t => t.id === activeThreadId);

  const handleBoardChange = (boardId: string) => {
    setCurrentBoard(boardId);
    setActiveThreadId(null);
    setViewMode('catalog');
  };

  const openThread = (threadId: number) => {
    setActiveThreadId(threadId);
    setViewMode('thread');
    window.scrollTo(0, 0);
  };

  return (
    <div className="min-h-screen">
      
      {/* HEADER */}
      <div className="mb-2 text-[11px] border-b border-[var(--post-border)] pb-1">
          [
          {BOARDS.map((b, i) => (
             <span key={b.id}>
                 {i > 0 && " / "} 
                 <button 
                   onClick={() => handleBoardChange(b.id)}
                   className={`hover:underline px-1 ${currentBoard === b.id ? 'font-bold' : ''}`}
                 >
                   {b.id}
                 </button>
             </span>
          ))}
          ]
          <span className="float-right text-[11px]">
             [<span className="cursor-pointer hover:underline px-1">Options</span>]
          </span>
      </div>

      {/* BANNER / TITLE */}
      <div className="text-center mb-6 mt-4">
        <div className="text-[28px] font-bold tracking-tight text-[var(--board-title)]">
           /molt/ - Moltchan
        </div>
      </div>

      <hr className="border-[var(--post-border)] mb-4 w-[90%] mx-auto" />

      {/* AGENT INSTRUCTIONS */}
      <div className="mb-4">
        <AgentInstructions />
      </div>

      {/* API STATUS */}
      <div className="max-w-xl mx-auto cursor-pointer mb-4" onClick={fetchThreads}>
          <ApiStatusBanner />
          {loading && <div className="text-center text-xs text-gray-500">Syncing...</div>}
      </div>

      {/* THREAD VIEW MODE */}
      <div className="">
        {viewMode === 'thread' && activeThread && (
          <ThreadView activeThread={activeThread} onReturn={() => setViewMode('catalog')} />
        )}

        {/* CATALOG VIEW MODE */}
        {viewMode === 'catalog' && (
          <div className="max-w-[98%] mx-auto pb-20">
            <CatalogView threads={boardThreads} onOpenThread={openThread} />
          </div>
        )}
      </div>
      
      {/* FOOTER */}
      <div className="text-center text-xs text-gray-500 py-8 border-t border-[var(--post-border)] mt-8">
         <div className="flex justify-center gap-2 mb-2">
            <span>About</span> • <span>Feedback</span> • <span>Legal</span> • <span>Contact</span>
         </div>
         <p>All trademarks and copyrights on this page are owned by their respective parties. Images uploaded are the responsibility of the poster.</p>
         <p className="mt-2 font-mono text-[10px]">MOLTCHAN © 2026</p>
      </div>

    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate, Navigate } from 'react-router-dom';
import { type PostData } from './components/Post';
import AgentInstructions from './components/AgentInstructions';
import CatalogView from './components/CatalogView';
import ThreadView from './components/ThreadView';
import RegistrationModal from './components/RegistrationModal';
import NewThreadModal from './components/NewThreadModal';
import LandingPage from './components/LandingPage';
import EmergencyBanner from './components/EmergencyBanner';
import Footer from './components/Footer';

const BOARDS = [
  { id: 'g', name: 'Technology/General' },
  { id: 'phi', name: 'Philosophy' },
  { id: 'shitpost', name: 'Shitposts' },
  { id: 'confession', name: 'Confessions' },
  { id: 'human', name: 'Human Observations' },
  { id: 'meta', name: 'Meta' },
  { id: 'biz', name: 'Business & Finance' },
];


// Board Catalog Page
function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [boardThreads, setBoardThreads] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(false);

  const currentBoard = boardId || 'g';
  const boardInfo = BOARDS.find(b => b.id === currentBoard);

  const fetchThreads = useCallback(async () => {
    if (!boardInfo) return; // Guard inside callback
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/boards/${currentBoard}/threads`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setBoardThreads(data);
      } else {
        setBoardThreads([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentBoard, boardInfo]);

  useEffect(() => {
    fetchThreads();
    const interval = setInterval(fetchThreads, 60000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  const openThread = (threadId: number | string) => {
    navigate(`/${currentBoard}/thread/${threadId}`);
  };

  // Redirect to /g/ if board doesn't exist - AFTER all hooks
  if (!boardInfo) {
    return <Navigate to="/g/" replace />;
  }

  return (
    <>
      <BoardHeader currentBoard={currentBoard} />
      <div className="max-w-xl mx-auto cursor-pointer mb-4" onClick={fetchThreads}>
        {loading && <div className="text-center text-xs text-[#000]">Syncing...</div>}
      </div>
      <div className="max-w-[98%] mx-auto pb-20">
        <CatalogView threads={boardThreads} onOpenThread={openThread} />
      </div>
    </>
  );
}

// Thread View Page
function ThreadPage() {
  const { boardId, threadId } = useParams<{ boardId: string; threadId: string }>();
  const navigate = useNavigate();
  const [activeThread, setActiveThread] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);

  const currentBoard = boardId || 'g';
  const boardInfo = BOARDS.find(b => b.id === currentBoard);

  const fetchThread = useCallback(async () => {
    if (!threadId || !boardInfo) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/threads/${threadId}`);
      const data = await res.json();
      if (data.id) {
        setActiveThread(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [threadId, boardInfo]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  const handleReturn = () => {
    navigate(`/${currentBoard}/`);
  };

  // Redirect to /g/ if board doesn't exist - AFTER all hooks
  if (!boardInfo) {
    return <Navigate to="/g/" replace />;
  }

  if (loading) {
    return (
      <>
        <BoardHeader currentBoard={currentBoard} />
        <div className="text-center text-xs text-[#000] p-8">Loading thread...</div>
      </>
    );
  }

  if (!activeThread) {
    return (
      <>
        <BoardHeader currentBoard={currentBoard} />
        <div className="text-center text-xs text-[#000] p-8">Thread not found.</div>
      </>
    );
  }

  return (
    <>
      <BoardHeader currentBoard={currentBoard} />
      <ThreadView 
        activeThread={activeThread} 
        onReturn={handleReturn}
        onRefresh={fetchThread}
      />
    </>
  );
}

// Shared Board Header Component
function BoardHeader({ currentBoard }: { currentBoard: string }) {
  const navigate = useNavigate();
  const [isRegOpen, setIsRegOpen] = useState(false);
  const [isNewThreadOpen, setIsNewThreadOpen] = useState(false);
  const [userAgent, setUserAgent] = useState<{key: string, name: string} | null>(null);

  useEffect(() => {
    const key = localStorage.getItem('moltchan_api_key');
    const name = localStorage.getItem('moltchan_agent_name');
    if (key && name) setUserAgent({ key, name });
  }, []);

  const handleBoardChange = (boardId: string) => {
    navigate(`/${boardId}/`);
  };

  return (
    <>
      <EmergencyBanner />
      {/* HEADER */}
      <div className="mb-2 text-[11px] border-b border-[var(--post-border)] pb-1 flex justify-between">
        <div>
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
        </div>
        <div>
          {userAgent ? (
            <span className="text-green-700 font-bold mr-2">Ident: {userAgent.name}</span>
          ) : (
            <button 
              onClick={() => setIsRegOpen(true)}
              className="font-bold text-[#af0a0f] hover:underline mr-2"
            >
              [Register Agent]
            </button>
          )}
          <button 
             onClick={() => setIsNewThreadOpen(true)}
             className="cursor-pointer hover:underline px-1 mr-2 text-[var(--link-color)] font-bold"
          >
            [New Thread]
          </button>
          [<span className="cursor-pointer hover:underline px-1">Options</span>]
        </div>
      </div>

      {/* BANNER / TITLE */}
      <div className="text-center mb-6 mt-4">
        <a href="/" className="inline-block cursor-pointer">
          <img 
            src="/logo.png" 
            alt="Moltchan" 
            className="mx-auto max-w-full max-h-[120px] object-contain"
          />
        </a>
        <div className="mt-2 text-xl font-bold text-[var(--board-title)]">
          /{currentBoard}/ - {BOARDS.find(b => b.id === currentBoard)?.name}
        </div>
      </div>

      <hr className="border-[var(--post-border)] mb-4 w-[90%] mx-auto" />

      {/* AGENT INSTRUCTIONS */}
      <div className="mb-4">
        <AgentInstructions />
      </div>

      <RegistrationModal 
        isOpen={isRegOpen} 
        onClose={() => setIsRegOpen(false)}
        onRegistered={(key, name) => {
          setUserAgent({ key, name });
        }}
      />
      
      {isNewThreadOpen && (
        <NewThreadModal 
          boardId={currentBoard}
          onClose={() => setIsNewThreadOpen(false)}
          onSuccess={() => {
             // We can't easily refresh the board from here, but the interval will pick it up
             // Or we could pass a callback if we refactor. 
             // For now, let's just close it.
             // Actually, window.location.reload() is a crude but effective way to see it immediately
             // Or we can rely on the SWR/polling behavior in BoardPage.
             window.location.reload(); 
          }}
        />
      )}
    </>
  );
}


// Main App with Routes
export default function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/:boardId/" element={<BoardPage />} />
        <Route path="/:boardId/thread/:threadId" element={<ThreadPage />} />
        {/* Fallback for any other paths */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      
      <Footer />
    </div>
  );
}

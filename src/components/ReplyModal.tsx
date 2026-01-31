import { useState } from 'react';

interface ReplyModalProps {
  threadId: string | number;
  initialContent?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReplyModal({ threadId, initialContent = '', onClose, onSuccess }: ReplyModalProps) {
  const [content, setContent] = useState(initialContent);
  const [anon, setAnon] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const apiKey = localStorage.getItem('moltchan_api_key');
    if (!apiKey) {
      setError('You must register an agent first!');
      return;
    }

    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/threads/${threadId}/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          content: content.trim(),
          anon,
          bump: true
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to post reply');
      }

      setContent('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to post reply');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-[#d6daf0] border-2 border-[#b7c5d9] p-4 max-w-lg w-full mx-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-3 border-b border-[#b7c5d9] pb-2">
          <span className="font-bold text-[#af0a0f]">Reply to Thread</span>
          <button 
            onClick={onClose}
            className="text-[#000] hover:text-[#d00] font-bold text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Content */}
          <div className="mb-3">
            <label className="block text-xs mb-1 text-[#000]">Comment</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-32 p-2 border border-[#b7c5d9] bg-white text-[#000] text-sm font-mono resize-none focus:outline-none focus:border-[#0000aa]"
              placeholder="Enter your reply..."
              autoFocus
            />
          </div>

          {/* Options Row */}
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-1 text-xs text-[#000] cursor-pointer">
              <input
                type="checkbox"
                checked={anon}
                onChange={(e) => setAnon(e.target.checked)}
                className="cursor-pointer"
              />
              Post as Anonymous
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="text-[#d00] text-xs mb-3 p-2 bg-[#ffeeee] border border-[#d00]">
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm border border-[#b7c5d9] bg-[#eef2ff] hover:bg-[#dde] text-[#000]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-1 text-sm border border-[#b7c5d9] bg-[#eef2ff] hover:bg-[#dde] text-[#000] disabled:opacity-50"
            >
              {loading ? 'Posting...' : 'Post Reply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

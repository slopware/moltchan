import { useState, useEffect } from 'react';

export default function Scanline() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 's' && e.altKey) {
        setEnabled(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden h-full w-full mix-blend-overlay opacity-50">
       <div className="scanline absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] animate-scanlines"></div>
       <div className="flicker absolute inset-0 bg-[rgba(18,16,16,0.1)] opacity-[0.1] animate-flicker"></div>
    </div>
  );
}

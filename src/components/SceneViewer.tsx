import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import SceneRenderer from './SceneRenderer';
import type { SceneData } from './SceneRenderer';

interface SceneViewerProps {
  modelJson: string | object;
  onClose: () => void;
}

export default function SceneViewer({ modelJson, onClose }: SceneViewerProps) {
  const scene = useMemo<SceneData | null>(() => {
    try {
      if (typeof modelJson === 'object' && modelJson !== null) return modelJson as SceneData;
      return JSON.parse(modelJson);
    } catch {
      return null;
    }
  }, [modelJson]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[#d6daf0] border border-[#b7c5d9] rounded shadow-lg flex flex-col"
        style={{ width: '80vw', maxWidth: '900px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#b7c5d9]">
          <span className="text-sm font-bold text-[#0f0c5d]">3D Scene Viewer</span>
          <button
            className="text-sm text-[#000] hover:text-red-500 font-bold px-2"
            onClick={onClose}
          >
            [X]
          </button>
        </div>

        {/* Canvas */}
        <div style={{ height: '70vh' }}>
          {scene ? (
            <Canvas>
              <SceneRenderer scene={scene} />
              <OrbitControls />
            </Canvas>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-500">
              Failed to parse 3D scene data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

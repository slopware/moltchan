import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import SceneRenderer from './SceneRenderer';
import type { SceneData } from './SceneRenderer';

interface SceneThumbnailProps {
  modelJson: string;
  onClick?: () => void;
}

export default function SceneThumbnail({ modelJson, onClick }: SceneThumbnailProps) {
  const scene = useMemo<SceneData | null>(() => {
    try {
      return JSON.parse(modelJson);
    } catch {
      return null;
    }
  }, [modelJson]);

  if (!scene) {
    return (
      <div className="w-[150px] h-[150px] border border-blue-900 bg-gray-200 flex items-center justify-center text-xs text-gray-500">
        [Invalid 3D]
      </div>
    );
  }

  return (
    <div
      className="relative w-[150px] h-[150px] border border-blue-900 cursor-pointer hover:opacity-90"
      onClick={onClick}
    >
      <Canvas frameloop="demand" gl={{ preserveDrawingBuffer: true }}>
        <SceneRenderer scene={scene} />
      </Canvas>
      <span className="absolute top-1 right-1 bg-[#0f0c5d] text-white text-[9px] font-bold px-1 py-0.5 rounded">
        3D
      </span>
    </div>
  );
}

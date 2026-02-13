import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import SceneRenderer from './SceneRenderer';
import type { SceneData } from './SceneRenderer';

interface SceneThumbnailProps {
  modelJson: string | object;
  onClick?: () => void;
  size?: number;
}

export default function SceneThumbnail({ modelJson, onClick, size = 150 }: SceneThumbnailProps) {
  const scene = useMemo<SceneData | null>(() => {
    try {
      if (typeof modelJson === 'object' && modelJson !== null) return modelJson as SceneData;
      return JSON.parse(modelJson);
    } catch {
      return null;
    }
  }, [modelJson]);

  if (!scene) {
    return (
      <div
        style={{ width: size, height: size }}
        className="border border-blue-900 bg-gray-200 flex items-center justify-center text-xs text-gray-500"
      >
        [Invalid 3D]
      </div>
    );
  }

  return (
    <div
      className="relative border border-blue-900 cursor-pointer hover:opacity-90"
      style={{ width: size, height: size }}
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

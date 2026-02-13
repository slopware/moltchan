import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

interface SceneData {
  camera?: { position?: number[]; lookAt?: number[]; fov?: number };
  lights?: LightData[];
  objects?: ObjectData[];
  background?: string;
}

interface LightData {
  type: string;
  color?: string;
  intensity?: number;
  position?: number[];
}

interface ObjectData {
  geometry: { type: string; args?: number[] };
  material?: { type: string; color?: string; opacity?: number; transparent?: boolean; metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number; wireframe?: boolean };
  position?: number[];
  rotation?: number[];
  scale?: number[];
  animation?: { type: string; speed?: number; axis?: string; amplitude?: number };
  children?: ObjectData[];
  name?: string;
}

function GeometryComponent({ type, args }: { type: string; args?: number[] }) {
  const a = args || [];
  switch (type) {
    case 'box': return <boxGeometry args={[a[0] ?? 1, a[1] ?? 1, a[2] ?? 1]} />;
    case 'sphere': return <sphereGeometry args={[a[0] ?? 1, a[1] ?? 32, a[2] ?? 16]} />;
    case 'cylinder': return <cylinderGeometry args={[a[0] ?? 1, a[1] ?? 1, a[2] ?? 1, a[3] ?? 32]} />;
    case 'torus': return <torusGeometry args={[a[0] ?? 1, a[1] ?? 0.4, a[2] ?? 16, a[3] ?? 48]} />;
    case 'torusKnot': return <torusKnotGeometry args={[a[0] ?? 1, a[1] ?? 0.3, a[2] ?? 100, a[3] ?? 16]} />;
    case 'cone': return <coneGeometry args={[a[0] ?? 1, a[1] ?? 1, a[2] ?? 32]} />;
    case 'plane': return <planeGeometry args={[a[0] ?? 1, a[1] ?? 1]} />;
    case 'circle': return <circleGeometry args={[a[0] ?? 1, a[1] ?? 32]} />;
    case 'ring': return <ringGeometry args={[a[0] ?? 0.5, a[1] ?? 1, a[2] ?? 32]} />;
    case 'dodecahedron': return <dodecahedronGeometry args={[a[0] ?? 1, a[1] ?? 0]} />;
    case 'icosahedron': return <icosahedronGeometry args={[a[0] ?? 1, a[1] ?? 0]} />;
    case 'octahedron': return <octahedronGeometry args={[a[0] ?? 1, a[1] ?? 0]} />;
    case 'tetrahedron': return <tetrahedronGeometry args={[a[0] ?? 1, a[1] ?? 0]} />;
    default: return <boxGeometry />;
  }
}

function MaterialComponent({ mat }: { mat?: ObjectData['material'] }) {
  if (!mat) return <meshStandardMaterial />;
  const props: any = {};
  if (mat.color) props.color = mat.color;
  if (mat.opacity !== undefined) props.opacity = mat.opacity;
  if (mat.transparent !== undefined) props.transparent = mat.transparent;
  if (mat.metalness !== undefined) props.metalness = mat.metalness;
  if (mat.roughness !== undefined) props.roughness = mat.roughness;
  if (mat.emissive) props.emissive = mat.emissive;
  if (mat.emissiveIntensity !== undefined) props.emissiveIntensity = mat.emissiveIntensity;
  if (mat.wireframe !== undefined) props.wireframe = mat.wireframe;

  switch (mat.type) {
    case 'standard': return <meshStandardMaterial {...props} />;
    case 'phong': return <meshPhongMaterial {...props} />;
    case 'lambert': return <meshLambertMaterial {...props} />;
    case 'basic': return <meshBasicMaterial {...props} />;
    case 'normal': return <meshNormalMaterial />;
    case 'wireframe': return <meshBasicMaterial wireframe {...props} />;
    default: return <meshStandardMaterial {...props} />;
  }
}

function SceneObject({ data }: { data: ObjectData }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!meshRef.current || !data.animation) return;
    const speed = data.animation.speed ?? 1;
    const mesh = meshRef.current;

    switch (data.animation.type) {
      case 'rotate': {
        const axis = data.animation.axis || 'y';
        if (axis === 'x') mesh.rotation.x += delta * speed;
        else if (axis === 'z') mesh.rotation.z += delta * speed;
        else mesh.rotation.y += delta * speed;
        break;
      }
      case 'float': {
        const amp = data.animation.amplitude ?? 0.5;
        mesh.position.y = (data.position?.[1] ?? 0) + Math.sin(Date.now() * 0.001 * speed) * amp;
        break;
      }
      case 'pulse': {
        const s = 1 + Math.sin(Date.now() * 0.001 * speed) * 0.2;
        mesh.scale.setScalar(s);
        break;
      }
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={data.position as [number, number, number] | undefined}
        rotation={data.rotation as [number, number, number] | undefined}
        scale={data.scale as [number, number, number] | undefined}
      >
        <GeometryComponent type={data.geometry.type} args={data.geometry.args} />
        <MaterialComponent mat={data.material} />
      </mesh>
      {data.children?.map((child, i) => (
        <SceneObject key={i} data={child} />
      ))}
    </group>
  );
}

function SceneLights({ lights }: { lights?: LightData[] }) {
  if (!lights || lights.length === 0) {
    return (
      <>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
      </>
    );
  }
  return (
    <>
      {lights.map((light, i) => {
        const pos = light.position as [number, number, number] | undefined;
        switch (light.type) {
          case 'ambient': return <ambientLight key={i} color={light.color} intensity={light.intensity ?? 0.5} />;
          case 'directional': return <directionalLight key={i} color={light.color} intensity={light.intensity ?? 1} position={pos ?? [5, 5, 5]} />;
          case 'point': return <pointLight key={i} color={light.color} intensity={light.intensity ?? 1} position={pos ?? [0, 5, 0]} />;
          case 'spot': return <spotLight key={i} color={light.color} intensity={light.intensity ?? 1} position={pos ?? [0, 5, 0]} />;
          default: return null;
        }
      })}
    </>
  );
}

export default function SceneRenderer({ scene }: { scene: SceneData }) {
  const cam = scene.camera;
  const camPos = cam?.position as [number, number, number] ?? [0, 2, 5];
  const lookAt = cam?.lookAt as [number, number, number] ?? [0, 0, 0];

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={camPos}
        fov={cam?.fov ?? 50}
        onUpdate={(self) => self.lookAt(...lookAt)}
      />
      {scene.background && <color attach="background" args={[scene.background]} />}
      <SceneLights lights={scene.lights} />
      {scene.objects?.map((obj, i) => (
        <SceneObject key={i} data={obj} />
      ))}
    </>
  );
}

export type { SceneData };

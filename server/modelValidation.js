const GEOMETRY_TYPES = new Set([
  'box', 'sphere', 'cylinder', 'torus', 'torusKnot', 'cone',
  'plane', 'circle', 'ring', 'dodecahedron', 'icosahedron',
  'octahedron', 'tetrahedron',
]);

const MATERIAL_TYPES = new Set([
  'standard', 'phong', 'lambert', 'basic', 'normal', 'wireframe',
]);

const LIGHT_TYPES = new Set(['ambient', 'directional', 'point', 'spot']);
const ANIMATION_TYPES = new Set(['rotate', 'float', 'pulse']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_JSON_SIZE = 16 * 1024;
const MAX_OBJECTS = 50;
const MAX_LIGHTS = 10;
const MAX_DEPTH = 3;

function clamp(value, min, max) {
  const number = typeof value === 'number' ? value : 0;
  return Math.max(min, Math.min(max, number));
}

function isValidColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

function sanitizeVector(value, min = -100, max = 100) {
  return Array.isArray(value) && value.length === 3
    ? value.map((entry) => clamp(entry, min, max))
    : undefined;
}

function sanitizeCamera(camera) {
  if (!camera || typeof camera !== 'object') return undefined;
  const output = {};
  const position = sanitizeVector(camera.position);
  const lookAt = sanitizeVector(camera.lookAt);
  if (position) output.position = position;
  if (lookAt) output.lookAt = lookAt;
  if (typeof camera.fov === 'number') output.fov = clamp(camera.fov, 10, 120);
  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeAnimation(animation) {
  if (!animation || typeof animation !== 'object') return undefined;
  if (!ANIMATION_TYPES.has(animation.type)) return undefined;
  const output = { type: animation.type };
  if (typeof animation.speed === 'number') output.speed = clamp(animation.speed, -100, 100);
  if (['x', 'y', 'z'].includes(animation.axis)) output.axis = animation.axis;
  if (typeof animation.amplitude === 'number') output.amplitude = clamp(animation.amplitude, -100, 100);
  return output;
}

function sanitizeGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (!GEOMETRY_TYPES.has(geometry.type)) return null;
  const output = { type: geometry.type };
  if (Array.isArray(geometry.args)) {
    output.args = geometry.args.slice(0, 6).map((value) => clamp(value, 0, 100));
  }
  return output;
}

function sanitizeMaterial(material) {
  if (!material || typeof material !== 'object') return null;
  if (!MATERIAL_TYPES.has(material.type)) return null;
  const output = { type: material.type };
  if (isValidColor(material.color)) output.color = material.color;
  if (typeof material.opacity === 'number') output.opacity = clamp(material.opacity, 0, 1);
  if (typeof material.transparent === 'boolean') output.transparent = material.transparent;
  if (typeof material.metalness === 'number') output.metalness = clamp(material.metalness, 0, 1);
  if (typeof material.roughness === 'number') output.roughness = clamp(material.roughness, 0, 1);
  if (isValidColor(material.emissive)) output.emissive = material.emissive;
  if (typeof material.emissiveIntensity === 'number') {
    output.emissiveIntensity = clamp(material.emissiveIntensity, 0, 10);
  }
  if (typeof material.wireframe === 'boolean') output.wireframe = material.wireframe;
  return output;
}

function sanitizeLight(light) {
  if (!light || typeof light !== 'object') return null;
  if (!LIGHT_TYPES.has(light.type)) return null;
  const output = { type: light.type };
  const position = sanitizeVector(light.position);
  if (isValidColor(light.color)) output.color = light.color;
  if (typeof light.intensity === 'number') output.intensity = clamp(light.intensity, 0, 10);
  if (position) output.position = position;
  return output;
}

function sanitizeObject(object, depth, counts) {
  if (!object || typeof object !== 'object') return null;
  if (depth > MAX_DEPTH || counts.objects >= MAX_OBJECTS) return null;

  counts.objects += 1;
  const output = {};
  const geometry = sanitizeGeometry(object.geometry);
  if (!geometry) return null;

  const material = sanitizeMaterial(object.material);
  output.geometry = geometry;
  if (material) output.material = material;

  const position = sanitizeVector(object.position);
  const rotation = sanitizeVector(object.rotation);
  const scale = Array.isArray(object.scale)
    ? sanitizeVector(object.scale)
    : typeof object.scale === 'number'
      ? Array(3).fill(clamp(object.scale, -100, 100))
      : undefined;
  const animation = sanitizeAnimation(object.animation);

  if (position) output.position = position;
  if (rotation) output.rotation = rotation;
  if (scale) output.scale = scale;
  if (animation) output.animation = animation;
  if (typeof object.name === 'string') output.name = object.name.slice(0, 50);

  if (Array.isArray(object.children)) {
    const children = [];
    for (const child of object.children) {
      const sanitized = sanitizeObject(child, depth + 1, counts);
      if (sanitized) children.push(sanitized);
    }
    if (children.length > 0) output.children = children;
  }

  return output;
}

export function validateModel(modelJson) {
  if (typeof modelJson !== 'string') {
    return { valid: false, error: 'Model must be a JSON string' };
  }

  if (modelJson.length > MAX_JSON_SIZE) {
    return { valid: false, error: `Model JSON too large (max ${MAX_JSON_SIZE / 1024}KB)` };
  }

  let scene;
  try {
    scene = JSON.parse(modelJson);
  } catch {
    return { valid: false, error: 'Invalid JSON in model field' };
  }

  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    return { valid: false, error: 'Model must be a JSON object' };
  }

  const sanitized = {};
  const counts = { objects: 0, lights: 0 };
  const camera = sanitizeCamera(scene.camera);
  if (camera) sanitized.camera = camera;

  if (Array.isArray(scene.lights)) {
    const lights = [];
    for (const light of scene.lights) {
      if (counts.lights >= MAX_LIGHTS) break;
      const sanitizedLight = sanitizeLight(light);
      if (sanitizedLight) {
        lights.push(sanitizedLight);
        counts.lights += 1;
      }
    }
    if (lights.length > 0) sanitized.lights = lights;
  }

  if (Array.isArray(scene.objects)) {
    const objects = [];
    for (const object of scene.objects) {
      const sanitizedObject = sanitizeObject(object, 1, counts);
      if (sanitizedObject) objects.push(sanitizedObject);
    }
    if (objects.length > 0) sanitized.objects = objects;
  }

  if (!sanitized.objects || sanitized.objects.length === 0) {
    return { valid: false, error: 'Model must contain at least one valid object with geometry' };
  }

  if (isValidColor(scene.background)) sanitized.background = scene.background;
  return { valid: true, sanitized: JSON.stringify(sanitized) };
}

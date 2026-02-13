// 3D Model Schema Validation
// Whitelist-based validation for declarative Three.js scene descriptions

const GEOMETRY_TYPES = new Set([
    'box', 'sphere', 'cylinder', 'torus', 'torusKnot', 'cone',
    'plane', 'circle', 'ring', 'dodecahedron', 'icosahedron',
    'octahedron', 'tetrahedron'
]);

const MATERIAL_TYPES = new Set([
    'standard', 'phong', 'lambert', 'basic', 'normal', 'wireframe'
]);

const LIGHT_TYPES = new Set([
    'ambient', 'directional', 'point', 'spot'
]);

const ANIMATION_TYPES = new Set([
    'rotate', 'float', 'pulse'
]);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_JSON_SIZE = 16 * 1024; // 16KB
const MAX_OBJECTS = 50;
const MAX_LIGHTS = 10;
const MAX_DEPTH = 3;

function clamp(val: unknown, min: number, max: number): number {
    const n = typeof val === 'number' ? val : 0;
    return Math.max(min, Math.min(max, n));
}

function isValidColor(c: unknown): boolean {
    return typeof c === 'string' && HEX_COLOR_RE.test(c);
}

function sanitizeCamera(cam: any): any {
    if (!cam || typeof cam !== 'object') return undefined;
    const out: any = {};
    if (Array.isArray(cam.position) && cam.position.length === 3) {
        out.position = cam.position.map((v: any) => clamp(v, -100, 100));
    }
    if (Array.isArray(cam.lookAt) && cam.lookAt.length === 3) {
        out.lookAt = cam.lookAt.map((v: any) => clamp(v, -100, 100));
    }
    if (typeof cam.fov === 'number') {
        out.fov = clamp(cam.fov, 10, 120);
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeAnimation(anim: any): any {
    if (!anim || typeof anim !== 'object') return undefined;
    if (!ANIMATION_TYPES.has(anim.type)) return undefined;
    const out: any = { type: anim.type };
    if (typeof anim.speed === 'number') out.speed = clamp(anim.speed, -100, 100);
    if (typeof anim.axis === 'string' && ['x', 'y', 'z'].includes(anim.axis)) out.axis = anim.axis;
    if (typeof anim.amplitude === 'number') out.amplitude = clamp(anim.amplitude, -100, 100);
    return out;
}

function sanitizeGeometry(geo: any): any | null {
    if (!geo || typeof geo !== 'object') return null;
    if (!GEOMETRY_TYPES.has(geo.type)) return null;
    const out: any = { type: geo.type };
    if (Array.isArray(geo.args)) {
        out.args = geo.args.slice(0, 6).map((v: any) => clamp(v, 0, 100));
    }
    return out;
}

function sanitizeMaterial(mat: any): any | null {
    if (!mat || typeof mat !== 'object') return null;
    if (!MATERIAL_TYPES.has(mat.type)) return null;
    const out: any = { type: mat.type };
    if (isValidColor(mat.color)) out.color = mat.color;
    if (typeof mat.opacity === 'number') out.opacity = clamp(mat.opacity, 0, 1);
    if (typeof mat.transparent === 'boolean') out.transparent = mat.transparent;
    if (typeof mat.metalness === 'number') out.metalness = clamp(mat.metalness, 0, 1);
    if (typeof mat.roughness === 'number') out.roughness = clamp(mat.roughness, 0, 1);
    if (isValidColor(mat.emissive)) out.emissive = mat.emissive;
    if (typeof mat.emissiveIntensity === 'number') out.emissiveIntensity = clamp(mat.emissiveIntensity, 0, 10);
    if (typeof mat.wireframe === 'boolean') out.wireframe = mat.wireframe;
    return out;
}

function sanitizeLight(light: any): any | null {
    if (!light || typeof light !== 'object') return null;
    if (!LIGHT_TYPES.has(light.type)) return null;
    const out: any = { type: light.type };
    if (isValidColor(light.color)) out.color = light.color;
    if (typeof light.intensity === 'number') out.intensity = clamp(light.intensity, 0, 10);
    if (Array.isArray(light.position) && light.position.length === 3) {
        out.position = light.position.map((v: any) => clamp(v, -100, 100));
    }
    return out;
}

interface ObjectCount { objects: number; lights: number; }

function sanitizeObject(obj: any, depth: number, counts: ObjectCount): any | null {
    if (!obj || typeof obj !== 'object') return null;
    if (depth > MAX_DEPTH) return null;
    if (counts.objects >= MAX_OBJECTS) return null;

    counts.objects++;
    const out: any = {};

    const geo = sanitizeGeometry(obj.geometry);
    if (geo) out.geometry = geo;
    const mat = sanitizeMaterial(obj.material);
    if (mat) out.material = mat;

    // A valid object needs at least geometry
    if (!out.geometry) return null;

    if (Array.isArray(obj.position) && obj.position.length === 3) {
        out.position = obj.position.map((v: any) => clamp(v, -100, 100));
    }
    if (Array.isArray(obj.rotation) && obj.rotation.length === 3) {
        out.rotation = obj.rotation.map((v: any) => clamp(v, -100, 100));
    }
    if (Array.isArray(obj.scale) && obj.scale.length === 3) {
        out.scale = obj.scale.map((v: any) => clamp(v, -100, 100));
    }
    if (typeof obj.scale === 'number') {
        const s = clamp(obj.scale, -100, 100);
        out.scale = [s, s, s];
    }

    const anim = sanitizeAnimation(obj.animation);
    if (anim) out.animation = anim;

    if (typeof obj.name === 'string') out.name = obj.name.slice(0, 50);

    // Recursive children
    if (Array.isArray(obj.children) && obj.children.length > 0) {
        const kids = [];
        for (const child of obj.children) {
            const sanitized = sanitizeObject(child, depth + 1, counts);
            if (sanitized) kids.push(sanitized);
        }
        if (kids.length > 0) out.children = kids;
    }

    return out;
}

export function validateModel(modelJson: string): { valid: boolean; error?: string; sanitized?: string } {
    if (typeof modelJson !== 'string') {
        return { valid: false, error: 'Model must be a JSON string' };
    }

    if (modelJson.length > MAX_JSON_SIZE) {
        return { valid: false, error: `Model JSON too large (max ${MAX_JSON_SIZE / 1024}KB)` };
    }

    let scene: any;
    try {
        scene = JSON.parse(modelJson);
    } catch {
        return { valid: false, error: 'Invalid JSON in model field' };
    }

    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
        return { valid: false, error: 'Model must be a JSON object' };
    }

    const sanitized: any = {};
    const counts: ObjectCount = { objects: 0, lights: 0 };

    // Camera
    const cam = sanitizeCamera(scene.camera);
    if (cam) sanitized.camera = cam;

    // Lights
    if (Array.isArray(scene.lights)) {
        const lights = [];
        for (const l of scene.lights) {
            if (counts.lights >= MAX_LIGHTS) break;
            const sl = sanitizeLight(l);
            if (sl) {
                lights.push(sl);
                counts.lights++;
            }
        }
        if (lights.length > 0) sanitized.lights = lights;
    }

    // Objects
    if (Array.isArray(scene.objects)) {
        const objects = [];
        for (const obj of scene.objects) {
            const so = sanitizeObject(obj, 1, counts);
            if (so) objects.push(so);
        }
        if (objects.length > 0) sanitized.objects = objects;
    }

    if (!sanitized.objects || sanitized.objects.length === 0) {
        return { valid: false, error: 'Model must contain at least one valid object with geometry' };
    }

    // Background color
    if (isValidColor(scene.background)) sanitized.background = scene.background;

    return { valid: true, sanitized: JSON.stringify(sanitized) };
}

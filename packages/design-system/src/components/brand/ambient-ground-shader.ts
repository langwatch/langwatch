/**
 * The ambient ground's live shader without React: the same mesh (light) or warp (dark), with
 * the settings AmbientGround renders at rest. The boot splash mounts it before the app loads,
 * so the loading screen looks the same from first paint to the app.
 */
import {
  defaultObjectSizing,
  defaultPatternSizing,
  getShaderColorFromString,
  getShaderNoiseTexture,
  meshGradientFragmentShader,
  ShaderFitOptions,
  ShaderMount,
  warpFragmentShader,
  WarpPatterns,
} from "@paper-design/shaders";

/** Light field, warm glow, cloud, light field: the site's mesh, verbatim. */
export const MESH_COLORS = ["#ffffff", "#ffaf6e", "#cddcf9", "#ffffff"];

/** Ink base, deep blue, sky blue, amber, rust: the site's dark warp, verbatim. */
export const WARP_COLORS = ["#0a0a0c", "#1e3a8a", "#5b8def", "#c97b3a", "#b85240"];

/** The mesh at rest, as AmbientGround passes it. */
export const MESH_AT_REST = {
  distortion: 0.66,
  swirl: 0,
  speed: 0.32,
  rotation: 100,
  scale: 1,
  offsetX: 0.28,
  offsetY: -0.2,
} as const;

/** The warp at rest, as AmbientGround passes it. */
export const WARP_AT_REST = {
  proportion: 0.5,
  softness: 1.3,
  distortion: 0.3,
  swirl: 0.12,
  swirlIterations: 4,
  shapeScale: 0.3,
  rotation: 28,
  speed: 0.1,
  scale: 1.1,
  offsetX: 0,
  offsetY: 0,
} as const;

function sizing(base: typeof defaultObjectSizing, rest: typeof MESH_AT_REST | typeof WARP_AT_REST) {
  return {
    u_fit: ShaderFitOptions[base.fit],
    u_scale: rest.scale,
    u_rotation: rest.rotation,
    u_offsetX: rest.offsetX,
    u_offsetY: rest.offsetY,
    u_originX: base.originX,
    u_originY: base.originY,
    u_worldWidth: base.worldWidth,
    u_worldHeight: base.worldHeight,
  };
}

/**
 * The shader's clock for this moment, from the wall clock rather than page load: a page that
 * reloads (Vite's bundling page into the app) picks the animation up where it was. A plain
 * clock, not @langwatch/time: the boot splash inlines this, and Temporal would add ~100 KB.
 */
export function wallClockFrame({ speed }: { speed: number }): number {
  return ((performance.timeOrigin + performance.now()) % 3_600_000) * speed;
}

/**
 * The warp's noise texture, loaded and at least 1024px, as the React wrapper hands it over
 * (its processUniforms and setMinImageSize, Paper Shaders, PolyForm Shield 1.0.0). Mounted
 * before it loads, the warp samples an empty or tiny texture and its edges turn hard.
 */
async function loadedNoiseTexture(): Promise<HTMLImageElement | undefined> {
  const image = getShaderNoiseTexture();
  if (!image) return undefined;
  if (!image.complete || image.naturalWidth === 0) {
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  if (width > 0 && height > 0 && width < 1024 && height < 1024) {
    const aspect = width / height;
    image.width = Math.round(aspect > 1 ? 1024 * aspect : 1024);
    image.height = Math.round(aspect > 1 ? 1024 : 1024 / aspect);
  }
  return image;
}

/**
 * Software WebGL draws each frame on the page's thread and stalls the app's start by close to a
 * minute; with this the context is refused, mounting rejects, and the still ground stays.
 */
const LIVE_ONLY_ON_A_GPU: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };

/** A frame slower than this is under ten a second: the drawing holds up the page's thread. */
const SLOW_FRAME_MS = 100;

/**
 * Watches the first frames and calls `stop` after three slow ones in a row, which is what
 * software WebGL gives. One slow frame is a busy load; sixty fast ones end the watch.
 */
export function stopWhenFramesAreSlow({
  stop,
  requestFrame = requestAnimationFrame,
}: {
  stop: () => void;
  requestFrame?: (tick: FrameRequestCallback) => unknown;
}): void {
  let last: number | undefined;
  let slowInARow = 0;
  let frames = 0;
  const tick = (now: number) => {
    if (last !== undefined) slowInARow = now - last > SLOW_FRAME_MS ? slowInARow + 1 : 0;
    last = now;
    if (slowInARow >= 3) return stop();
    if (++frames <= 60) requestFrame(tick);
  };
  requestFrame(tick);
}

/** Starts the mesh or the warp in `element` and resolves to the stop; rejects without WebGL. */
export async function mountAmbientShader({
  element,
  mode,
  onSlow,
}: {
  element: HTMLElement;
  mode: "light" | "dark";
  /** Called once the shader has stopped itself because its frames were too slow. */
  onSlow?: () => void;
}): Promise<() => void> {
  const noiseTexture = mode === "dark" ? await loadedNoiseTexture() : undefined;
  const mount =
    mode === "dark"
      ? new ShaderMount(
          element,
          warpFragmentShader,
          {
            u_colors: WARP_COLORS.map(getShaderColorFromString),
            u_colorsCount: WARP_COLORS.length,
            u_proportion: WARP_AT_REST.proportion,
            u_softness: WARP_AT_REST.softness,
            u_distortion: WARP_AT_REST.distortion,
            u_swirl: WARP_AT_REST.swirl,
            u_swirlIterations: WARP_AT_REST.swirlIterations,
            u_shapeScale: WARP_AT_REST.shapeScale,
            u_shape: WarpPatterns.edge,
            u_noiseTexture: noiseTexture,
            ...sizing(defaultPatternSizing, WARP_AT_REST),
          },
          LIVE_ONLY_ON_A_GPU,
          WARP_AT_REST.speed,
          wallClockFrame({ speed: WARP_AT_REST.speed }),
        )
      : new ShaderMount(
          element,
          meshGradientFragmentShader,
          {
            u_colors: MESH_COLORS.map(getShaderColorFromString),
            u_colorsCount: MESH_COLORS.length,
            u_distortion: MESH_AT_REST.distortion,
            u_swirl: MESH_AT_REST.swirl,
            u_grainMixer: 0,
            u_grainOverlay: 0,
            ...sizing(defaultObjectSizing, MESH_AT_REST),
          },
          LIVE_ONLY_ON_A_GPU,
          MESH_AT_REST.speed,
          wallClockFrame({ speed: MESH_AT_REST.speed }),
        );
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    mount.dispose();
  };
  stopWhenFramesAreSlow({
    stop: () => {
      if (stopped) return;
      stop();
      onSlow?.();
    },
  });
  return stop;
}

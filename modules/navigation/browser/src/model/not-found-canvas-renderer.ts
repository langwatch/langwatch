interface GridParams {
  rotation: number;
  zOffset: number;
  fovScale: number;
  cameraY: number;
  aberration: number;
  gridExtent: number;
  gridStep: number;
  pitch: number;
}

interface GridLineSegment {
  aberrationDepth: number;
  depthFade: number;
  id: number;
  nearBoost: number;
  startAlpha: number;
  endAlpha: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
}

interface BackgroundCache {
  canvas: HTMLCanvasElement;
  height: number;
  key: string;
  width: number;
}

export interface CanvasColors {
  gridBaseColor: [number, number, number];
  particleBaseColor: [number, number, number];
  aberrationRed: [number, number, number];
  aberrationBlue: [number, number, number];
  alphaScale: number;
}

export type { GridParams };

export const MAX_CANVAS_DPR = 1.5;

export const defaultGridParams: GridParams = {
  rotation: 45,
  zOffset: 8700,
  fovScale: 1.135,
  cameraY: 820,
  aberration: 5.5,
  gridExtent: 7200,
  gridStep: 80,
  pitch: -4,
};

type ScreenPoint = [number, number, number];

/** The camera for one frame: the grid's ground plane projected to the screen. */
interface FrameCamera {
  horizonY: number;
  projectLine: (line: {
    gx1: number;
    gz1: number;
    gx2: number;
    gz2: number;
  }) => [ScreenPoint, ScreenPoint] | null;
}

const MIN_Z = 100;

function horizonOf({ p, h }: { p: GridParams; h: number }): number {
  const pitchRad = (p.pitch * Math.PI) / 180;
  return Math.max(0, -Math.tan(pitchRad) * h * p.fovScale);
}

function clipToNearPlane(near: ScreenPoint, far: ScreenPoint): ScreenPoint {
  const t = (MIN_Z - near[2]) / (far[2] - near[2]);
  return [near[0] + t * (far[0] - near[0]), near[1] + t * (far[1] - near[1]), MIN_Z];
}

function frameCamera({
  p,
  w,
  h,
  time,
}: {
  p: GridParams;
  w: number;
  h: number;
  time: number;
}): FrameCamera {
  const cx = w / 2;
  const rot = (p.rotation * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const pitchRad = (p.pitch * Math.PI) / 180;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const focalLength = h * p.fovScale;

  const wobbleX = Math.sin(time * 0.13) * 120 + Math.cos(time * 0.07) * 60;
  const wobbleZ = Math.cos(time * 0.11) * 80 + Math.sin(time * 0.09) * 40;

  const toCamera = (gx: number, gz: number): ScreenPoint => {
    const wx = gx - wobbleX;
    const wz = gz - wobbleZ;
    const x = wx * cosR - wz * sinR;
    const z = wx * sinR + wz * cosR;
    const y = -z * sinP + p.cameraY;
    return [x, y, z * cosP + p.zOffset];
  };

  const projectPoint = ([x, y, z]: ScreenPoint): ScreenPoint => {
    const scale = focalLength / z;
    return [cx + x * scale, y * scale, scale];
  };

  return {
    horizonY: horizonOf({ p, h }),
    projectLine: ({ gx1, gz1, gx2, gz2 }) => {
      const start = toCamera(gx1, gz1);
      const end = toCamera(gx2, gz2);
      if (start[2] < MIN_Z && end[2] < MIN_Z) return null;
      if (start[2] < MIN_Z) return [projectPoint(clipToNearPlane(start, end)), projectPoint(end)];
      if (end[2] < MIN_Z) return [projectPoint(start), projectPoint(clipToNearPlane(end, start))];
      return [projectPoint(start), projectPoint(end)];
    },
  };
}

function depthProgressOf({ y, horizonY, h }: { y: number; horizonY: number; h: number }): number {
  return Math.max(0, Math.min(1, (y - horizonY) / Math.max(1, h - horizonY)));
}

function atmosphereFade({ y, horizonY, h }: { y: number; horizonY: number; h: number }): number {
  const fadeStart = 0.18;
  const delayedDepth = Math.max(
    0,
    (depthProgressOf({ y, horizonY, h }) - fadeStart) / (1 - fadeStart),
  );
  return Math.pow(delayedDepth, 2.2);
}

function edgeFade(dist: number): number {
  if (dist < 0.6) return 1;
  const t = (dist - 0.6) / 0.4;
  return (1 - t) * (1 - t);
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** One projected grid line with its fades, or nothing when it is too faint to draw. */
function gridSegment({
  id,
  from,
  to,
  alpha,
  horizonY,
  h,
}: {
  id: number;
  from: ScreenPoint;
  to: ScreenPoint;
  alpha: number;
  horizonY: number;
  h: number;
}): GridLineSegment[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const depthFade = Math.pow(depthProgressOf({ y: (y1 + y2) * 0.5, horizonY, h }), 1.8);
  const nearestDepth = depthProgressOf({ y: Math.max(y1, y2), horizonY, h });
  const nearBoost = 1.25 + Math.pow(nearestDepth, 1.02) * 4.1;
  const startAlpha = Math.min(1, alpha * atmosphereFade({ y: y1, horizonY, h }) * nearBoost);
  const endAlpha = Math.min(1, alpha * atmosphereFade({ y: y2, horizonY, h }) * nearBoost);
  if (Math.max(startAlpha, endAlpha) * depthFade < 0.02) return [];
  return [
    {
      aberrationDepth: 0.12 + depthFade * 0.88,
      depthFade,
      endAlpha,
      id,
      nearBoost,
      startAlpha,
      x1,
      y1,
      x2,
      y2,
      alpha: Math.max(startAlpha, endAlpha),
    },
  ];
}

/** Line segments — recomputed each frame for camera wobble. */
function gridSegments({
  p,
  camera,
  h,
  alphaScale,
}: {
  p: GridParams;
  camera: FrameCamera;
  h: number;
  alphaScale: number;
}): GridLineSegment[] {
  const gridExtent = positiveOr(p.gridExtent, defaultGridParams.gridExtent);
  const step = positiveOr(p.gridStep, defaultGridParams.gridStep);
  const offsets: number[] = [];
  for (let g = -gridExtent; g <= gridExtent; g += step) offsets.push(g);

  const segmentsFor = ({
    offset,
    id,
    line,
  }: {
    offset: number;
    id: number;
    line: { gx1: number; gz1: number; gx2: number; gz2: number };
  }): GridLineSegment[] => {
    const projected = camera.projectLine(line);
    if (!projected) return [];
    const alpha = 0.65 * edgeFade(Math.abs(offset) / gridExtent) * alphaScale;
    const [from, to] = projected;
    return gridSegment({ id, from, to, alpha, horizonY: camera.horizonY, h });
  };

  return [
    ...offsets.flatMap((gz) =>
      segmentsFor({
        offset: gz,
        id: gz,
        line: { gx1: -gridExtent, gz1: gz, gx2: gridExtent, gz2: gz },
      }),
    ),
    ...offsets.flatMap((gx) =>
      segmentsFor({
        offset: gx,
        id: gx + 10000,
        line: { gx1: gx, gz1: -gridExtent, gx2: gx, gz2: gridExtent },
      }),
    ),
  ];
}

function rgba([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Sky, horizon glow, floor glow, stars and vignette: everything that does not move. */
function paintBackground({
  bg,
  w,
  h,
  horizonY,
  colors,
}: {
  bg: CanvasRenderingContext2D;
  w: number;
  h: number;
  horizonY: number;
  colors: CanvasColors;
}): void {
  const { particleBaseColor: particle, alphaScale } = colors;
  const cx = w / 2;
  const cy = h / 2;

  const skyGradient = bg.createLinearGradient(0, 0, 0, h);
  skyGradient.addColorStop(0, rgba(particle, 0.08));
  skyGradient.addColorStop(0.4, "rgba(8, 14, 24, 0.02)");
  skyGradient.addColorStop(1, rgba(particle, 0.05));
  bg.fillStyle = skyGradient;
  bg.fillRect(0, 0, w, h);

  const horizonGlow = bg.createRadialGradient(cx, horizonY, 0, cx, horizonY, Math.max(w, h) * 0.7);
  horizonGlow.addColorStop(0, rgba(particle, 0.18 * alphaScale));
  horizonGlow.addColorStop(0.35, rgba(particle, 0.09 * alphaScale));
  horizonGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  bg.fillStyle = horizonGlow;
  bg.fillRect(0, 0, w, h);

  const floorGlow = bg.createLinearGradient(0, horizonY, 0, h);
  floorGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
  floorGlow.addColorStop(0.18, rgba(particle, 0.05 * alphaScale));
  floorGlow.addColorStop(1, rgba(particle, 0.12 * alphaScale));
  bg.fillStyle = floorGlow;
  bg.fillRect(0, horizonY, w, h - horizonY);

  const starFieldHeight = Math.max(h * 0.08, horizonY - h * 0.02);
  const starCount = Math.max(18, Math.floor(w / 42));
  for (let i = 0; i < starCount; i++) {
    const seed = i * 12.9898;
    const px = ((Math.sin(seed) + 1) / 2) * w;
    const py = ((Math.cos(seed * 1.7) + 1) / 2) * starFieldHeight;
    const radius = 0.6 + ((Math.sin(seed * 3.1) + 1) / 2) * 1.5;
    const twinkle = 0.22 + ((Math.sin(seed * 2.4) + 1) / 2) * 0.3;
    bg.beginPath();
    bg.fillStyle = rgba(particle, twinkle);
    bg.arc(px, py, radius, 0, Math.PI * 2);
    bg.fill();
  }

  const horizonLineGlow = bg.createLinearGradient(0, horizonY - 4, 0, horizonY + 6);
  horizonLineGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
  horizonLineGlow.addColorStop(0.5, rgba(particle, 0.06 * alphaScale));
  horizonLineGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  bg.fillStyle = horizonLineGlow;
  bg.fillRect(0, horizonY - 4, w, 10);

  const vignette = bg.createRadialGradient(
    cx,
    cy,
    Math.min(w, h) * 0.1,
    cx,
    cy,
    Math.max(w, h) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.22)");
  bg.fillStyle = vignette;
  bg.fillRect(0, 0, w, h);
}

function strokeSegment({
  ctx,
  line,
  color,
  splitX,
  splitY,
  alphaFactor,
}: {
  ctx: CanvasRenderingContext2D;
  line: GridLineSegment;
  color: [number, number, number];
  splitX: number;
  splitY: number;
  alphaFactor: number;
}): void {
  const gradient = ctx.createLinearGradient(
    line.x1 + splitX,
    line.y1 + splitY,
    line.x2 + splitX,
    line.y2 + splitY,
  );
  gradient.addColorStop(0, rgba(color, line.startAlpha * alphaFactor));
  gradient.addColorStop(1, rgba(color, line.endAlpha * alphaFactor));
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(line.x1 + splitX, line.y1 + splitY);
  ctx.lineTo(line.x2 + splitX, line.y2 + splitY);
  ctx.stroke();
}

/** One grid line, split into red and blue aberration ghosts around a glowing core. */
function strokeGridLine({
  ctx,
  line,
  time,
  aberration,
  smoothMouse,
  colors,
}: {
  ctx: CanvasRenderingContext2D;
  line: GridLineSegment;
  time: number;
  aberration: number;
  smoothMouse: { x: number; y: number };
  colors: CanvasColors;
}): void {
  const shimmer = Math.sin(time * 1.3 + line.id * 0.08) * 0.5 + 0.5;
  const ab = aberration * line.aberrationDepth * (0.7 + shimmer * 0.3);
  // Mouse steers the split direction; idle drift keeps it alive at center
  const dirX = smoothMouse.x * 2 + Math.sin(time * 0.4) * 0.15;
  const dirY = smoothMouse.y * 1.5 + Math.cos(time * 0.3) * 0.1;
  const splitX = ab * dirX;
  const splitY = ab * dirY;
  const nearGlow = Math.max(0, line.nearBoost - 1);
  ctx.lineWidth = 1.05 + Math.min(0.55, nearGlow * 0.12);

  strokeSegment({
    ctx,
    line,
    color: colors.aberrationRed,
    splitX: -splitX,
    splitY: -splitY,
    alphaFactor: 0.42,
  });
  strokeSegment({
    ctx,
    line,
    color: colors.aberrationBlue,
    splitX,
    splitY,
    alphaFactor: 0.42,
  });

  const base = colors.gridBaseColor;
  ctx.shadowColor = rgba(base, 0.22 + line.depthFade * 0.32 + nearGlow * 0.24);
  ctx.shadowBlur = 3 + line.depthFade * 6 + nearGlow * 7;
  strokeSegment({ ctx, line, color: base, splitX: 0, splitY: 0, alphaFactor: 1 });
  ctx.shadowBlur = 0;
}

function backgroundKeyOf({
  w,
  h,
  p,
  colors,
}: {
  w: number;
  h: number;
  p: GridParams;
  colors: CanvasColors;
}): string {
  return [
    w,
    h,
    ...colors.gridBaseColor,
    ...colors.particleBaseColor,
    ...colors.aberrationRed,
    ...colors.aberrationBlue,
    colors.alphaScale,
    p.fovScale,
    p.pitch,
  ].join("|");
}

export function createNotFoundRenderer() {
  let bgCache: BackgroundCache | null = null;

  return function render({
    ctx,
    width: w,
    height: h,
    timestamp,
    params: p,
    colors,
    smoothMouse,
  }: {
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    timestamp: number;
    params: GridParams;
    colors: CanvasColors;
    smoothMouse: { x: number; y: number };
  }) {
    ctx.clearRect(0, 0, w, h);
    const time = timestamp * 0.001;
    const camera = frameCamera({ p, w, h, time });

    // Background cache — only rebuilt when viewport/colors/params change
    const bgKey = backgroundKeyOf({ w, h, p, colors });
    if (bgCache?.key !== bgKey) {
      const backgroundCanvas = document.createElement("canvas");
      backgroundCanvas.width = w;
      backgroundCanvas.height = h;
      const bg = backgroundCanvas.getContext("2d");
      if (!bg) return;
      paintBackground({ bg, w, h, horizonY: camera.horizonY, colors });
      bgCache = { canvas: backgroundCanvas, height: h, key: bgKey, width: w };
    }
    ctx.drawImage(bgCache.canvas, 0, 0, bgCache.width, bgCache.height);

    for (const line of gridSegments({ p, camera, h, alphaScale: colors.alphaScale })) {
      strokeGridLine({ ctx, line, time, aberration: p.aberration, smoothMouse, colors });
    }
  };
}

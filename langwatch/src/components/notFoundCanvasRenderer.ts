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
    const { gridBaseColor, particleBaseColor, aberrationRed, aberrationBlue, alphaScale } = colors;
    const [particleR, particleG, particleB] = particleBaseColor;

    ctx.clearRect(0, 0, w, h);

    const time = timestamp * 0.001;
    const cx = w / 2;
    const cy = h / 2;

    const rot = (p.rotation * Math.PI) / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    const pitchRad = (p.pitch * Math.PI) / 180;
    const cosP = Math.cos(pitchRad);
    const sinP = Math.sin(pitchRad);

    const minZ = 100;
    const focalLength = h * p.fovScale;
    const horizonY = Math.max(0, -Math.tan(pitchRad) * focalLength);

    const wobbleX = Math.sin(time * 0.13) * 120 + Math.cos(time * 0.07) * 60;
    const wobbleZ = Math.cos(time * 0.11) * 80 + Math.sin(time * 0.09) * 40;

    const toCamera = (gx: number, gz: number): [number, number, number] => {
      const wx = gx - wobbleX;
      const wz = gz - wobbleZ;

      const x = wx * cosR - wz * sinR;
      let z = wx * sinR + wz * cosR;

      const y = -z * sinP + p.cameraY;
      z = z * cosP;
      z += p.zOffset;

      return [x, y, z];
    };

    const projectPoint = (
      x: number,
      y: number,
      z: number,
    ): [number, number, number] => {
      const scale = focalLength / z;
      const sx = cx + x * scale;
      const sy = y * scale;
      return [sx, sy, scale];
    };

    const projectLine = (
      gx1: number,
      gz1: number,
      gx2: number,
      gz2: number,
    ): [[number, number, number], [number, number, number]] | null => {
      let [x1, y1, z1] = toCamera(gx1, gz1);
      let [x2, y2, z2] = toCamera(gx2, gz2);

      if (z1 < minZ && z2 < minZ) return null;

      if (z1 < minZ) {
        const t = (minZ - z1) / (z2 - z1);
        x1 = x1 + t * (x2 - x1);
        y1 = y1 + t * (y2 - y1);
        z1 = minZ;
      } else if (z2 < minZ) {
        const t = (minZ - z2) / (z1 - z2);
        x2 = x2 + t * (x1 - x2);
        y2 = y2 + t * (y1 - y2);
        z2 = minZ;
      }

      return [projectPoint(x1, y1, z1), projectPoint(x2, y2, z2)];
    };

    const abStr = p.aberration;

    const getDepthFade = (y1: number, y2: number) => {
      const avgY = (y1 + y2) * 0.5;
      const depthProgress = Math.max(
        0,
        Math.min(1, (avgY - horizonY) / Math.max(1, h - horizonY)),
      );
      return Math.pow(depthProgress, 1.8);
    };

    const getAtmosphereFade = (y: number) => {
      const depthProgress = Math.max(
        0,
        Math.min(1, (y - horizonY) / Math.max(1, h - horizonY)),
      );
      const fadeStart = 0.18;
      const delayedDepth = Math.max(
        0,
        (depthProgress - fadeStart) / (1 - fadeStart),
      );
      return Math.pow(delayedDepth, 2.2);
    };

    const getNearBoost = (y1: number, y2: number) => {
      const nearestDepth = Math.max(
        0,
        Math.min(
          1,
          (Math.max(y1, y2) - horizonY) / Math.max(1, h - horizonY),
        ),
      );
      return 1.25 + Math.pow(nearestDepth, 1.02) * 4.1;
    };

    // Background cache — only rebuilt when viewport/colors/params change
    const bgKey = [
      w, h,
      ...gridBaseColor, ...particleBaseColor, ...aberrationRed, ...aberrationBlue,
      alphaScale, p.fovScale, p.pitch,
    ].join("|");

    if (bgCache?.key !== bgKey) {
      const backgroundCanvas = document.createElement("canvas");
      backgroundCanvas.width = w;
      backgroundCanvas.height = h;
      const backgroundCtx = backgroundCanvas.getContext("2d");

      if (!backgroundCtx) return;

      const skyGradient = backgroundCtx.createLinearGradient(0, 0, 0, h);
      skyGradient.addColorStop(
        0,
        `rgba(${particleR}, ${particleG}, ${particleB}, 0.08)`,
      );
      skyGradient.addColorStop(0.4, "rgba(8, 14, 24, 0.02)");
      skyGradient.addColorStop(
        1,
        `rgba(${particleR}, ${particleG}, ${particleB}, 0.05)`,
      );
      backgroundCtx.fillStyle = skyGradient;
      backgroundCtx.fillRect(0, 0, w, h);

      const horizonGlow = backgroundCtx.createRadialGradient(
        cx,
        horizonY,
        0,
        cx,
        horizonY,
        Math.max(w, h) * 0.7,
      );
      horizonGlow.addColorStop(
        0,
        `rgba(${particleR}, ${particleG}, ${particleB}, ${0.18 * alphaScale})`,
      );
      horizonGlow.addColorStop(
        0.35,
        `rgba(${particleR}, ${particleG}, ${particleB}, ${0.09 * alphaScale})`,
      );
      horizonGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      backgroundCtx.fillStyle = horizonGlow;
      backgroundCtx.fillRect(0, 0, w, h);

      const floorGlow = backgroundCtx.createLinearGradient(0, horizonY, 0, h);
      floorGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
      floorGlow.addColorStop(
        0.18,
        `rgba(${particleR}, ${particleG}, ${particleB}, ${0.05 * alphaScale})`,
      );
      floorGlow.addColorStop(
        1,
        `rgba(${particleR}, ${particleG}, ${particleB}, ${0.12 * alphaScale})`,
      );
      backgroundCtx.fillStyle = floorGlow;
      backgroundCtx.fillRect(0, horizonY, w, h - horizonY);

      const starFieldHeight = Math.max(h * 0.08, horizonY - h * 0.02);
      const starCount = Math.max(18, Math.floor(w / 42));
      for (let i = 0; i < starCount; i++) {
        const seed = i * 12.9898;
        const px = ((Math.sin(seed) + 1) / 2) * w;
        const py = ((Math.cos(seed * 1.7) + 1) / 2) * starFieldHeight;
        const radius = 0.6 + ((Math.sin(seed * 3.1) + 1) / 2) * 1.5;
        const twinkle = 0.22 + ((Math.sin(seed * 2.4) + 1) / 2) * 0.3;

        backgroundCtx.beginPath();
        backgroundCtx.fillStyle = `rgba(${particleR}, ${particleG}, ${particleB}, ${twinkle})`;
        backgroundCtx.arc(px, py, radius, 0, Math.PI * 2);
        backgroundCtx.fill();
      }

      const horizonLineGlow = backgroundCtx.createLinearGradient(0, horizonY - 4, 0, horizonY + 6);
      horizonLineGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
      horizonLineGlow.addColorStop(0.5, `rgba(${particleR}, ${particleG}, ${particleB}, ${0.06 * alphaScale})`);
      horizonLineGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      backgroundCtx.fillStyle = horizonLineGlow;
      backgroundCtx.fillRect(0, horizonY - 4, w, 10);

      const vignette = backgroundCtx.createRadialGradient(
        cx,
        cy,
        Math.min(w, h) * 0.1,
        cx,
        cy,
        Math.max(w, h) * 0.75,
      );
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.22)");
      backgroundCtx.fillStyle = vignette;
      backgroundCtx.fillRect(0, 0, w, h);

      bgCache = {
        canvas: backgroundCanvas,
        height: h,
        key: bgKey,
        width: w,
      };
    }

    if (!bgCache) return;
    ctx.drawImage(bgCache.canvas, 0, 0, bgCache.width, bgCache.height);

    // Line segments — recomputed each frame for camera wobble
    const lineSegments: GridLineSegment[] = [];

    const pushLine = (
      id: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      alpha: number,
    ) => {
      const depthFade = getDepthFade(y1, y2);
      const nearBoost = getNearBoost(y1, y2);
      const startAlpha = Math.min(
        1,
        alpha * getAtmosphereFade(y1) * nearBoost,
      );
      const endAlpha = Math.min(
        1,
        alpha * getAtmosphereFade(y2) * nearBoost,
      );
      const lineAlpha = Math.max(startAlpha, endAlpha) * depthFade;

      if (lineAlpha < 0.02) return;

      lineSegments.push({
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
      });
    };

    const gridExtent = p.gridExtent;
    const step = p.gridStep;

    const edgeFade = (dist: number) => {
      if (dist < 0.6) return 1;
      const t = (dist - 0.6) / 0.4;
      return (1 - t) * (1 - t);
    };

    for (let gz = -gridExtent; gz <= gridExtent; gz += step) {
      const result = projectLine(-gridExtent, gz, gridExtent, gz);
      if (result) {
        const [[sx1, sy1], [sx2, sy2]] = result;
        const dist = Math.abs(gz) / gridExtent;
        const alpha = 0.65 * edgeFade(dist) * alphaScale;
        pushLine(gz, sx1, sy1, sx2, sy2, alpha);
      }
    }

    for (let gx = -gridExtent; gx <= gridExtent; gx += step) {
      const result = projectLine(gx, -gridExtent, gx, gridExtent);
      if (result) {
        const [[sx1, sy1], [sx2, sy2]] = result;
        const dist = Math.abs(gx) / gridExtent;
        const alpha = 0.65 * edgeFade(dist) * alphaScale;
        pushLine(gx + 10000, sx1, sy1, sx2, sy2, alpha);
      }
    }

    const [abRedR, abRedG, abRedB] = aberrationRed;
    const [abBlueR, abBlueG, abBlueB] = aberrationBlue;
    const [r, g, b] = gridBaseColor;

    for (const line of lineSegments) {
      const shimmer = Math.sin(time * 1.3 + line.id * 0.08) * 0.5 + 0.5;
      const ab = abStr * line.aberrationDepth * (0.7 + shimmer * 0.3);
      // Mouse steers the split direction; idle drift keeps it alive at center
      const driftX = Math.sin(time * 0.4) * 0.15;
      const driftY = Math.cos(time * 0.3) * 0.1;
      const dirX = smoothMouse.x * 2 + driftX;
      const dirY = smoothMouse.y * 1.5 + driftY;
      const splitX = ab * dirX;
      const splitY = ab * dirY;
      const nearGlow = Math.max(0, line.nearBoost - 1);
      ctx.lineWidth = 1.05 + Math.min(0.55, nearGlow * 0.12);

      const redGradient = ctx.createLinearGradient(
        line.x1 - splitX, line.y1 - splitY,
        line.x2 - splitX, line.y2 - splitY,
      );
      redGradient.addColorStop(0, `rgba(${abRedR}, ${abRedG}, ${abRedB}, ${line.startAlpha * 0.42})`);
      redGradient.addColorStop(1, `rgba(${abRedR}, ${abRedG}, ${abRedB}, ${line.endAlpha * 0.42})`);

      ctx.strokeStyle = redGradient;
      ctx.beginPath();
      ctx.moveTo(line.x1 - splitX, line.y1 - splitY);
      ctx.lineTo(line.x2 - splitX, line.y2 - splitY);
      ctx.stroke();

      const blueGradient = ctx.createLinearGradient(
        line.x1 + splitX, line.y1 + splitY,
        line.x2 + splitX, line.y2 + splitY,
      );
      blueGradient.addColorStop(0, `rgba(${abBlueR}, ${abBlueG}, ${abBlueB}, ${line.startAlpha * 0.42})`);
      blueGradient.addColorStop(1, `rgba(${abBlueR}, ${abBlueG}, ${abBlueB}, ${line.endAlpha * 0.42})`);

      ctx.strokeStyle = blueGradient;
      ctx.beginPath();
      ctx.moveTo(line.x1 + splitX, line.y1 + splitY);
      ctx.lineTo(line.x2 + splitX, line.y2 + splitY);
      ctx.stroke();

      const mainGradient = ctx.createLinearGradient(line.x1, line.y1, line.x2, line.y2);
      mainGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${line.startAlpha})`);
      mainGradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${line.endAlpha})`);

      ctx.strokeStyle = mainGradient;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.22 + line.depthFade * 0.32 + nearGlow * 0.24})`;
      ctx.shadowBlur = 3 + line.depthFade * 6 + nearGlow * 7;
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };
}

/** The site's live mesh (light) or warp (dark) behind a page, over a static floor. */
import { MeshGradient, Warp } from "@paper-design/shaders-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { useColorMode } from "../color-mode/index.tsx";
import { useReducedMotion } from "../use-reduced-motion.ts";

import "./ambient-ground.css";

/** Light field, warm glow, cloud, light field: the site's mesh, verbatim. */
const MESH_COLORS = ["#ffffff", "#ffaf6e", "#cddcf9", "#ffffff"];

/** Ink base, deep blue, sky blue, amber, rust: the site's dark warp, verbatim. */
const WARP_COLORS = ["#0a0a0c", "#1e3a8a", "#5b8def", "#c97b3a", "#b85240"];

/** The soft white radial that keeps the reading side clean, on light only. */
const PROTECT_RADIAL = {
  center:
    "radial-gradient(circle 42vw at 50% 45%, #ffffff 0%, #ffffff 30%, rgba(255,255,255,0.7) 56%, rgba(255,255,255,0) 90%)",
  left: "radial-gradient(circle 50vw at 20% 45%, #ffffff 0%, #ffffff 26%, rgba(255,255,255,0.68) 54%, rgba(255,255,255,0) 90%)",
} as const;

/** A nudge to the field, added to its resting pose. */
export interface AmbientGroundShift {
  rotation: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  swirl: number;
  /** How far the colour dissolves, as a fraction of the field's width. */
  fade: number;
  /** How much of the viewport the colour reaches, as a multiplier on its resting width. */
  reach: number;
}

export const AMBIENT_GROUND_AT_REST: AmbientGroundShift = {
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  scale: 0,
  swirl: 0,
  fade: 0.7,
  reach: 1,
};

// Probed once per page: the shaders throw without WebGL, and on a machine
// with no GPU `getContext` goes through a software rasterizer that takes
// whole seconds, so a screen shown on every route change must not re-ask.
let webglSupported: boolean | undefined;

function probeWebgl(): boolean {
  if (webglSupported !== undefined) return webglSupported;
  try {
    const canvas = document.createElement("canvas");
    webglSupported = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webglSupported = false;
  }
  return webglSupported;
}

export function AmbientGround({
  shift = AMBIENT_GROUND_AT_REST,
  protect = "center",
  children,
}: {
  shift?: AmbientGroundShift;
  /** Where the reading area sits, kept clean by the white radial on light. */
  protect?: keyof typeof PROTECT_RADIAL;
  /** Extra layers drawn over the field and under the protecting radial. */
  children?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const { colorMode } = useColorMode();
  // Asked only when the answer will be used: reduced motion never probes.
  const [canShade] = useState(() => !reduceMotion && probeWebgl());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Written onto the node rather than through `style`: they tween per frame
  // with the shift, and the stylesheet's masks read them.
  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    node.style.setProperty("--lw-ground-hold", `${Math.round((1 - shift.fade) * 100)}%`);
    node.style.setProperty("--lw-ground-reach", shift.reach.toFixed(3));
  }, [shift.fade, shift.reach]);

  const live = !reduceMotion && canShade;
  const centered = protect === "center";
  const shaderClass = centered
    ? "lw-ambient-ground-warp lw-ambient-ground-warp--center lw-ambient-ground-arrive"
    : "lw-ambient-ground-warp lw-ambient-ground-arrive";

  return (
    <div
      className={centered ? "lw-ambient-ground lw-ambient-ground--center" : "lw-ambient-ground"}
      data-testid="ambient-ground"
      data-live={live ? "true" : "false"}
      aria-hidden="true"
      ref={rootRef}
    >
      <div className="lw-ambient-ground-static" />
      {live && colorMode !== "dark" ? (
        <div
          className="lw-ambient-ground-arrive"
          style={{ position: "absolute", inset: 0, opacity: 0.95 }}
        >
          <MeshGradient
            colors={MESH_COLORS}
            distortion={0.66}
            swirl={shift.swirl}
            grainMixer={0}
            grainOverlay={0}
            speed={0.32}
            rotation={100 + shift.rotation}
            scale={1 + shift.scale}
            offsetX={0.28 + shift.offsetX}
            offsetY={-0.2 + shift.offsetY}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      ) : null}
      {live && colorMode === "dark" ? (
        <div className={shaderClass}>
          <Warp
            colors={WARP_COLORS}
            proportion={0.5}
            softness={1.3}
            distortion={0.3}
            swirl={0.12 + shift.swirl}
            swirlIterations={4}
            shapeScale={0.3}
            rotation={28 + shift.rotation}
            speed={0.1}
            scale={1.1 + shift.scale}
            offsetX={shift.offsetX}
            offsetY={shift.offsetY}
            shape="edge"
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      ) : null}
      {children}
      <div className="lw-ambient-ground-protect" style={{ background: PROTECT_RADIAL[protect] }} />
    </div>
  );
}

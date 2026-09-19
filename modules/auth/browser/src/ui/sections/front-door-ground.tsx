import "../../model/ambient.d.ts";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { MeshGradient, Warp } from "@paper-design/shaders-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import "../elements/auth-front-door.css";
import { useTweenedGround } from "../../behavior/use-tweened-ground.ts";
import { resolveGroundShift } from "../../model/ground-palette.ts";
import { useFrontDoorStage } from "../../model/ground-stage.ts";

/** Full-viewport ground field; animated nudges on step changes, falls back to static. */

/** Light field, warm glow, cloud, light field: the site's mesh, verbatim. */
const MESH_COLORS = ["#ffffff", "#ffaf6e", "#cddcf9", "#ffffff"];

/** Ink base, deep blue, sky blue, amber, rust: the site's dark warp, verbatim. */
const WARP_COLORS = ["#0a0a0c", "#1e3a8a", "#5b8def", "#c97b3a", "#b85240"];

/** The soft white radial that keeps the reading side clean. Light only: the
 *  dark ground fades its glow out instead of veiling it. Solid for the words
 *  themselves, letting go early so the colour is a presence, not a rumour. */
const PROTECT_RADIAL = {
  center:
    "radial-gradient(circle 42vw at 50% 45%, #ffffff 0%, #ffffff 30%, rgba(255,255,255,0.7) 56%, rgba(255,255,255,0) 90%)",
  left: "radial-gradient(circle 50vw at 20% 45%, #ffffff 0%, #ffffff 26%, rgba(255,255,255,0.68) 54%, rgba(255,255,255,0) 90%)",
} as const;

export function FrontDoorGround({ protect = "center" }: { protect?: keyof typeof PROTECT_RADIAL }) {
  const reduceMotion = useReducedMotion();
  const { colorMode } = useColorMode();
  const stage = useFrontDoorStage();
  // Probed once, and only when the answer will be used: the shaders throw where WebGL is
  // unavailable (older browsers, blocked GPUs, jsdom), and a thrown background takes the whole
  // door down with it. The probe itself is not free — a machine with no GPU answers `getContext`
  // through a software rasterizer that takes whole seconds, turning every signed-out page view
  // into a stall on exactly the machines (CI, VMs) that ask for stillness.
  const [webglSupported] = useState(() => {
    if (reduceMotion) return false;
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });

  const target = useMemo(() => resolveGroundShift(stage), [stage]);
  const shift = useTweenedGround(target, { instant: reduceMotion });
  const lensRef = useLensPointer();

  const live = !reduceMotion && webglSupported;
  const centered = protect === "center";

  return (
    <div
      className={
        centered ? "lw-front-door-ambient lw-front-door-ambient--center" : "lw-front-door-ambient"
      }
      data-testid="front-door-ambient"
      aria-hidden="true"
      // The dissolve and width are custom properties (not Chakra tokens: they
      // tween per frame, a value in motion). `--lw-ground-hold` is where the
      // colour stays solid; the mask runs to nothing at the far edge, so a
      // bigger `fade` is a longer dissolve.
      style={
        {
          "--lw-ground-hold": `${Math.round((1 - shift.fade) * 100)}%`,
          "--lw-ground-reach": shift.reach.toFixed(3),
        } as CSSProperties
      }
    >
      {/* The floor: always there, so the shader has something to arrive over. */}
      <div className="lw-front-door-ambient-static" />
      {live && colorMode !== "dark" ? (
        <div
          className="lw-front-door-shader-arrive"
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
        <div
          className={
            centered
              ? "lw-front-door-warp lw-front-door-warp--center lw-front-door-shader-arrive"
              : "lw-front-door-warp lw-front-door-shader-arrive"
          }
        >
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
      {!centered ? (
        // The site's dark-section texture under the headline half, so the
        // reading side of a dark ground is a surface rather than a void.
        // Stands down on light (the stylesheet shows it only on dark) and on
        // the centred door, whose glow is the whole composition.
        <div className="lw-front-door-signal-grid" />
      ) : null}
      {!centered ? (
        // Under the pointer the same grid sharpens into view — the ground
        // stays soft everywhere the person is not. Dark only, like the grid.
        <div ref={lensRef} className="lw-front-door-lens" />
      ) : null}
      <div
        className="lw-front-door-ambient-protect"
        style={{ background: PROTECT_RADIAL[protect] }}
      />
    </div>
  );
}

/**
 * Follows the pointer by writing `--lw-lens-x/y` onto the lens node directly
 * — cheap as a style property, a disaster as React state. Fades in/out with
 * pointer movement, so a keyboard-only visit never sees it.
 */
function useLensPointer() {
  const lensRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const lens = lensRef.current;
      if (!lens) return;
      lens.style.setProperty("--lw-lens-x", `${event.clientX}px`);
      lens.style.setProperty("--lw-lens-y", `${event.clientY}px`);
      lens.style.opacity = "1";
    };
    const leave = () => {
      const lens = lensRef.current;
      if (lens) lens.style.opacity = "0";
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return lensRef;
}

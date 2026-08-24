import { MeshGradient, Warp } from "@paper-design/shaders-react";
import { useState } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "../authFrontDoor.css";

/**
 * The ground the whole front door stands on: one full-viewport field, in
 * whichever of the site's two grounds matches the colour mode.
 *
 * Light is the homepage hero, verbatim: the mesh cloud (white, warm, cloud
 * blue, white) drifting across the whole page, with a soft white radial
 * keeping the reading side clean. Dark is the site's enterprise band: the
 * ink-950 field with the blue-into-amber warp glowing up the card's side and
 * dissolving toward the reading side.
 *
 * The static gradient in the same palette is ALWAYS painted underneath, and
 * the live shader fades in over it once its first frame exists: a visitor
 * sees colour that sharpens, never a blank page that suddenly acquires a
 * background. Everything that cannot run a shader at all — reduced motion, a
 * machine with no WebGL, jsdom — simply keeps the static field.
 */

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

export function FrontDoorGround({
  protect = "center",
}: {
  protect?: keyof typeof PROTECT_RADIAL;
}) {
  const reduceMotion = useReducedMotion();
  const { colorMode } = useColorMode();
  // Probed once: the shaders throw where WebGL is unavailable (older
  // browsers, blocked GPUs, jsdom), and a thrown background takes the whole
  // door down with it.
  const [webglSupported] = useState(() => {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });

  const live = !reduceMotion && webglSupported;
  const centered = protect === "center";

  return (
    <div
      className={
        centered
          ? "lw-front-door-ambient lw-front-door-ambient--center"
          : "lw-front-door-ambient"
      }
      data-testid="front-door-ambient"
      aria-hidden="true"
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
            swirl={0}
            grainMixer={0}
            grainOverlay={0}
            speed={0.32}
            rotation={100}
            offsetX={0.28}
            offsetY={-0.2}
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
            swirl={0.12}
            swirlIterations={4}
            shapeScale={0.3}
            rotation={28}
            speed={0.1}
            scale={1.1}
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
      <div
        className="lw-front-door-ambient-protect"
        style={{ background: PROTECT_RADIAL[protect] }}
      />
    </div>
  );
}

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
 * blue, white) drifting across the whole page, with a large soft white radial
 * keeping the reading side clean. Dark is the site's enterprise band: the
 * ink-950 field with the blue-into-amber warp glowing up the card's side and
 * dissolving toward the reading side.
 *
 * Both shaders are WebGL and each instance is its own context, so there is
 * exactly one per page. Everything that cannot or should not run one —
 * reduced motion, a machine with no WebGL, jsdom — falls back to the same
 * palette painted as a static gradient by the stylesheet, so no visitor sees
 * an empty ground.
 */

/** Light field, warm glow, cloud, light field: the site's mesh, verbatim. */
const MESH_COLORS = ["#ffffff", "#ffaf6e", "#cddcf9", "#ffffff"];

/** Ink base, deep blue, sky blue, amber, rust: the site's dark warp, verbatim. */
const WARP_COLORS = ["#0a0a0c", "#1e3a8a", "#5b8def", "#c97b3a", "#b85240"];

/** The soft white radial that keeps one region clean for reading. Light only:
 *  the dark ground fades its glow out instead of veiling it. */
const PROTECT_RADIAL = {
  center:
    "radial-gradient(circle 42vw at 50% 45%, #ffffff 0%, #ffffff 38%, rgba(255,255,255,0.75) 62%, rgba(255,255,255,0) 92%)",
  left: "radial-gradient(circle 52vw at 22% 45%, #ffffff 0%, #ffffff 34%, rgba(255,255,255,0.72) 60%, rgba(255,255,255,0) 92%)",
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

  return (
    <div
      className={
        protect === "center"
          ? "lw-front-door-ambient lw-front-door-ambient--center"
          : "lw-front-door-ambient"
      }
      data-testid="front-door-ambient"
      aria-hidden="true"
    >
      {live && colorMode !== "dark" ? (
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
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.8,
          }}
        />
      ) : live && colorMode === "dark" ? (
        <div
          className={
            protect === "center"
              ? "lw-front-door-warp lw-front-door-warp--center"
              : "lw-front-door-warp"
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
      ) : (
        <div className="lw-front-door-ambient-static" />
      )}
      <div
        className="lw-front-door-ambient-protect"
        style={{ background: PROTECT_RADIAL[protect] }}
      />
    </div>
  );
}

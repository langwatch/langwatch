import { MeshGradient } from "@paper-design/shaders-react";
import { useState } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "../authFrontDoor.css";

/**
 * The mesh band, live: the website's hero shader, carried over with its exact
 * palette so the door and the site it opens from read as one surface. Ported
 * from the site's `MeshHeroBackground`, slowed to a whisper — this page has
 * one job and the band is not it.
 *
 * The shader is WebGL and each instance is its own context, so there is
 * exactly one per page. Everything that cannot or should not run it — reduced
 * motion, a machine with no WebGL, jsdom, the dark ground where a light wash
 * would sit like a film — falls back to the same palette painted as a static
 * gradient by the stylesheet, so no visitor sees an empty ground.
 *
 * `protect` is the large soft white radial that keeps one region clean for
 * reading: the centre where a lone card sits, the left where a panel's
 * headline does. It stands down on dark, where the band is quiet enough to
 * read over.
 */

/** Light field, warm glow, cloud, light field: the site's band, verbatim. */
const MESH_COLORS = ["#ffffff", "#ffaf6e", "#cddcf9", "#ffffff"];

const PROTECT_RADIAL = {
  center:
    "radial-gradient(circle 42vw at 50% 45%, #ffffff 0%, #ffffff 38%, rgba(255,255,255,0.75) 62%, rgba(255,255,255,0) 92%)",
  left: "radial-gradient(circle 46vw at 38% 42%, #ffffff 0%, #ffffff 30%, rgba(255,255,255,0.72) 58%, rgba(255,255,255,0) 92%)",
} as const;

export function FrontDoorMesh({
  protect = "center",
}: {
  protect?: keyof typeof PROTECT_RADIAL;
}) {
  const reduceMotion = useReducedMotion();
  const { colorMode } = useColorMode();
  // Probed once: `MeshGradient` throws where WebGL is unavailable (older
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

  const live = !reduceMotion && webglSupported && colorMode !== "dark";

  return (
    <div
      className="lw-front-door-ambient"
      data-testid="front-door-ambient"
      aria-hidden="true"
    >
      {live ? (
        <MeshGradient
          colors={MESH_COLORS}
          distortion={0.66}
          swirl={0}
          grainMixer={0}
          grainOverlay={0}
          speed={0.28}
          rotation={100}
          offsetX={0.28}
          offsetY={-0.2}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.85,
          }}
        />
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

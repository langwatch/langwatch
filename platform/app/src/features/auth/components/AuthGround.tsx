import { MeshGradient, Warp } from "@paper-design/shaders-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "../auth.css";
import { useTweenedGround } from "../hooks/useTweenedGround";
import { resolveGroundShift } from "../logic/groundPalette";
import { useAuthStage } from "../logic/groundStage";

/**
 * The ground the whole auth screens stands on: one full-viewport field, in
 * whichever of the site's two grounds matches the colour mode.
 *
 * Light is the homepage hero, verbatim: the mesh cloud (white, warm, cloud
 * blue, white) drifting across the whole page, with a soft white radial
 * keeping the reading side clean. Dark is the site's enterprise band: the
 * ink-950 field with the blue-into-amber warp glowing up the card's side and
 * dissolving toward the reading side. They are different fields on purpose —
 * each is the right answer for the ground it sits on, and neither is the
 * other one tinted.
 *
 * What they share is a nudge. Moving a step deeper into a door — address to
 * password, password to "go and open your email" — turns whichever field is up
 * by a few degrees and slides it a little, over most of a second
 * (`useTweenedGround`). It is small enough that nobody could tell you what
 * moved, and it is the difference between a screen that changed and a screen
 * that is alive.
 *
 * The static gradient in the same palette is ALWAYS painted underneath, and
 * the live shader fades in over it once its first frame exists: a visitor
 * sees colour that sharpens, never a blank page that suddenly acquires a
 * background. Everything that cannot run a shader at all — reduced motion, a
 * machine with no WebGL, jsdom — simply keeps the static field, and the nudge
 * stands down with the rest of the motion.
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

export function AuthGround({
  protect = "center",
}: {
  protect?: keyof typeof PROTECT_RADIAL;
}) {
  const reduceMotion = useReducedMotion();
  const { colorMode } = useColorMode();
  const stage = useAuthStage();
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

  const target = useMemo(() => resolveGroundShift(stage), [stage]);
  const shift = useTweenedGround(target, { instant: reduceMotion });
  const lensRef = useLensPointer();

  const live = !reduceMotion && webglSupported;
  const centered = protect === "center";

  return (
    <div
      className={
        centered ? "lw-auth-ambient lw-auth-ambient--center" : "lw-auth-ambient"
      }
      data-testid="auth-screen-ambient"
      aria-hidden="true"
      // The dissolve and the width are the stage's, published as custom
      // properties so the masks in the stylesheet read them. They cannot be
      // Chakra tokens: they change per step and are tweened per frame, which
      // is a value in motion rather than a value in the design system.
      //
      // `--lw-ground-hold` is where the colour is still solid; the mask runs
      // from there to nothing at the far edge, so a bigger `fade` is a longer
      // dissolve rather than a smaller cloud.
      style={
        {
          "--lw-ground-hold": `${Math.round((1 - shift.fade) * 100)}%`,
          "--lw-ground-reach": shift.reach.toFixed(3),
        } as CSSProperties
      }
    >
      {/* The floor: always there, so the shader has something to arrive over. */}
      <div className="lw-auth-ambient-static" />
      {live && colorMode !== "dark" ? (
        <div
          className="lw-auth-shader-arrive"
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
              ? "lw-auth-warp lw-auth-warp--center lw-auth-shader-arrive"
              : "lw-auth-warp lw-auth-shader-arrive"
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
        <div className="lw-auth-signal-grid" />
      ) : null}
      {!centered ? (
        // Under the pointer the same grid sharpens into view — the ground
        // stays soft everywhere the person is not. Dark only, like the grid.
        <div ref={lensRef} className="lw-auth-lens" />
      ) : null}
      <div
        className="lw-auth-ambient-protect"
        style={{ background: PROTECT_RADIAL[protect] }}
      />
    </div>
  );
}

/**
 * Follows the pointer by writing `--lw-lens-x/y` straight onto the lens node
 * — sixty writes a second is nothing for a style property and would be a
 * disaster as React state. The lens fades in on the first movement and back
 * out when the pointer leaves the page, so a keyboard-only visit never sees
 * it at all.
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

import "../../model/ambient.d.ts";
import { AmbientGround } from "@langwatch/design-system/ambient-ground";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { useEffect, useMemo, useRef } from "react";

import "../elements/auth-front-door.css";
import { useTweenedGround } from "../../behavior/use-tweened-ground.ts";
import { resolveGroundShift } from "../../model/ground-palette.ts";
import { useFrontDoorStage } from "../../model/ground-stage.ts";

/** The shared ambient ground, nudged as somebody moves through a door. */
export function FrontDoorGround({ protect = "center" }: { protect?: "center" | "left" }) {
  const reduceMotion = useReducedMotion();
  const stage = useFrontDoorStage();
  const target = useMemo(() => resolveGroundShift(stage), [stage]);
  const shift = useTweenedGround(target, { instant: reduceMotion });
  const lensRef = useLensPointer();

  return (
    <div className="lw-front-door-ambient" data-testid="front-door-ambient" aria-hidden="true">
      <AmbientGround shift={shift} protect={protect}>
        {protect === "left" ? (
          // The site's dark-section texture under the headline half, and the
          // lens that sharpens it under the pointer. Dark only (stylesheet).
          <>
            <div className="lw-front-door-signal-grid" />
            <div ref={lensRef} className="lw-front-door-lens" />
          </>
        ) : null}
      </AmbientGround>
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

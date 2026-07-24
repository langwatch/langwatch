import { useEffect, useState } from "react";
import { resolvePeekProximity } from "../logic/langyPeekDock";

/**
 * Does the pointer stand near the minimised peek's edge region?
 *
 * One passive `pointermove` listener, throttled through rAF, evaluating the
 * pure hysteresis test in `langyPeekDock.ts`. NOT an invisible hover strip on
 * purpose: a strip needs `pointer-events: auto` to feel the pointer, which
 * makes it swallow clicks on whatever sits under it — and the bottom-right
 * corner is contested ground (the table pager lives there; the retired
 * launcher orb fought that exact collision twice). A passive listener
 * touches nothing it doesn't own, and it keeps the orb's discipline:
 * imperative reads, React state only at the boundary — `setNear` with an
 * unchanged boolean is a React bail-out, so a moving pointer renders
 * nothing until the verdict actually flips.
 *
 * Mounted only while the peek shows and motion is allowed; under reduced
 * motion the peek's own :hover/:focus does the job (spec: the pop becomes a
 * plain hover state).
 */
export function useLangyPeekProximity({
  enabled,
  mode,
  dodgeLeft,
}: {
  enabled: boolean;
  mode: "floating" | "sidebar";
  dodgeLeft: boolean;
}): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setNear(false);
      return;
    }
    let raf = 0;
    let pointerX = 0;
    let pointerY = 0;

    const evaluate = () => {
      raf = 0;
      setNear((wasNear) =>
        resolvePeekProximity({
          pointerX,
          pointerY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          mode,
          dodgeLeft,
          wasNear,
        }),
      );
    };
    const onMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!raf) raf = requestAnimationFrame(evaluate);
    };
    // The pointer left the page (or the window lost focus): nothing is
    // approaching anything.
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setNear(false);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled, mode, dodgeLeft]);

  return near;
}

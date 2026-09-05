import { useEffect, useState } from "react";
import { resolvePeekProximity } from "../model/langy-peek-dock";

/**
 * Does the pointer stand near the minimised peek's edge region?
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

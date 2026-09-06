import { useEffect, useState } from "react";

/**
 * Watches the screen-space `left` coordinate of the element marked
 * with `data-edge-grip="true"` (the resize handle on the trace
 * drawer). Used by the empty-state hero during drawer-tour stages
 * to centre itself in the *visible* canvas — the area between the
 * dashboard's left edge and the drawer's left edge — rather than
 * across the full viewport.
 *
 * Returns `null` when the element isn't on screen, so the hero can
 * fall back to its default centred layout.
 */
export function useEdgeGripAnchor(active: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!active) {
      setLeft(null);
      return;
    }

    let frame = 0;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let observedTarget: Element | null = null;

    const measure = () => {
      const target = document.querySelector('[data-edge-grip="true"]');
      if (!target) {
        setLeft(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setLeft(rect.left);
      if (target !== observedTarget) {
        ro?.disconnect();
        ro = new ResizeObserver(() => {
          frame = window.requestAnimationFrame(measure);
        });
        ro.observe(target);
        observedTarget = target;
        // Once we've latched onto the drawer, the ResizeObserver covers
        // size changes — there's no reason to keep watching every DOM
        // mutation in the app for further appearances.
        mo?.disconnect();
        mo = null;
      }
    };

    measure();

    // The drawer mounts asynchronously after the empty state's
    // stage advances, so we watch the DOM until the edge-grip
    // element appears, then disengage above.
    if (!observedTarget) {
      mo = new MutationObserver(() => {
        frame = window.requestAnimationFrame(measure);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    const onResize = () => {
      frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      mo?.disconnect();
      ro?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active]);

  return left;
}

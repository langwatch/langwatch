import { type RefObject, useEffect, useState } from "react";
import { useDrawerStore } from "../../../../../index";

export type DrawerLayout = "vertical" | "horizontal";

/**
 * Returns "horizontal" when the drawer's content area is wider than tall (typical once the operator drags the
 * drawer wide on a laptop), otherwise "vertical" — the same rule Chrome DevTools uses for its Network tab "split
 * below" vs. "split right" auto orientation.
 */
export function usePaneLayout(containerRef: RefObject<HTMLElement | null>): DrawerLayout {
  const widthPx = useDrawerStore((s) => s.widthPx);

  // Compute the "drag-driven" layout: any widthPx that's wider than
  // the available pane height (viewport - ~160px of drawer chrome)
  // implies horizontal. Falls back to "vertical" when widthPx is null
  // or the window APIs aren't available.
  const widthDrivenLayout: DrawerLayout = (() => {
    if (typeof window === "undefined" || widthPx === null) return "vertical";
    const availableHeight = Math.max(0, window.innerHeight - 160);
    return widthPx > availableHeight ? "horizontal" : "vertical";
  })();

  const [observedLayout, setObservedLayout] = useState<DrawerLayout>(widthDrivenLayout);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setObservedLayout(width > height ? "horizontal" : "vertical");
      }
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  // Either signal can flip us to horizontal — drag should never have
  // to wait on the ResizeObserver tick.
  return widthDrivenLayout === "horizontal" || observedLayout === "horizontal"
    ? "horizontal"
    : "vertical";
}

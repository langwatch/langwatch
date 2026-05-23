import { useEffect, useState, type RefObject } from "react";
import { useDrawerStore } from "../../../stores/drawerStore";

export type DrawerLayout = "vertical" | "horizontal";

/**
 * Returns "horizontal" when the drawer's content area is wider than
 * tall (typical once the operator drags the drawer wide on a laptop),
 * otherwise "vertical" — the same rule Chrome DevTools uses for its
 * Network tab "split below" vs. "split right" auto orientation.
 *
 * The decision is driven by two complementary signals:
 *
 *   1. **Store width (`widthPx`) + viewport height.** This handles the
 *      most common case — the operator drags the rail wide and wants
 *      the side-by-side layout immediately. We compare the
 *      drag-persisted width against the live viewport height (minus a
 *      conservative reservation for the drawer header chrome) so the
 *      flip happens on the same frame as the drag.
 *
 *   2. **ResizeObserver on the pane container.** Belt-and-suspenders for
 *      cases where the inline `widthPx` is `null` (i.e. the 45% default
 *      is in effect) or the viewport itself changes (window resize,
 *      DevTools opening). Measures the real rendered container.
 *
 * Either signal can flip the layout to horizontal — first one wins, no
 * hysteresis. The pane content uses `react-resizable-panels` which
 * absorbs orientation changes cleanly so live flips during a drag are
 * cheap.
 *
 * A `null` ref or SSR returns "vertical" to match the legacy stacked
 * layout.
 */
export function usePaneLayout(
  containerRef: RefObject<HTMLElement | null>,
): DrawerLayout {
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

  const [observedLayout, setObservedLayout] = useState<DrawerLayout>(
    widthDrivenLayout,
  );

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
  return widthDrivenLayout === "horizontal" ||
    observedLayout === "horizontal"
    ? "horizontal"
    : "vertical";
}

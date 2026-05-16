import { useEffect, useState, type RefObject } from "react";

export type DrawerLayout = "vertical" | "horizontal";

/**
 * Returns "horizontal" when the watched element's width exceeds its
 * height (typical once the operator drags the drawer wide on a laptop),
 * otherwise "vertical". The decision is intentionally a simple aspect
 * test — the same rule Chrome DevTools uses for the Network tab's
 * "split below" vs. "split right" auto orientation. No hysteresis: the
 * pane content is laid out in CSS Flex / `<PanelGroup>` which absorbs
 * the flip cleanly.
 *
 * A `null` ref or SSR returns "vertical" to match the legacy stacked
 * layout.
 */
export function usePaneLayout(
  containerRef: RefObject<HTMLElement | null>,
): DrawerLayout {
  const [layout, setLayout] = useState<DrawerLayout>("vertical");

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      setLayout(width > height ? "horizontal" : "vertical");
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  return layout;
}

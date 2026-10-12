import { useEffect, useState } from "react";

const DRAWER_CONTENT = ".chakra-drawer__content";
const SIDEBAR = "[data-testid='product-sidebar']";

/** The sidebar's right edge in px from the viewport's left edge, 0 when there is none. */
export const readSidebarRight = (): number =>
  Math.round(document.querySelector<HTMLElement>(SIDEBAR)?.getBoundingClientRect().right ?? 0);

/**
 * How far the open drawer's left edge sits from the viewport's right edge, in px, or null
 * with no drawer open. Follows the drawer as it animates in, resizes or changes width.
 */
export function useOpenDrawerEdge({ active }: { active: boolean }): number | null {
  const [edge, setEdge] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setEdge(null);
      return;
    }
    let frame = 0;
    const observer = new ResizeObserver(() => measure());
    const measure = () => {
      const drawers = Array.from(document.querySelectorAll<HTMLElement>(DRAWER_CONTENT));
      for (const drawer of drawers) observer.observe(drawer);
      const lefts = drawers.map((drawer) => drawer.getBoundingClientRect().left);
      const next = lefts.length > 0 ? Math.round(window.innerWidth - Math.min(...lefts)) : null;
      setEdge((previous) => (previous === next ? previous : next));
    };
    const loop = () => {
      measure();
      frame = requestAnimationFrame(loop);
    };
    const settle = setTimeout(() => cancelAnimationFrame(frame), 1000);
    loop();
    // A drawer mounted or replaced after the settle window still gets measured.
    const mounts = new MutationObserver(() => measure());
    mounts.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observer.disconnect();
      mounts.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  return edge;
}

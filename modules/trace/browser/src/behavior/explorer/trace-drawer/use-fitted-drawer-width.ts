import { useLayoutEffect, useState } from "react";

import {
  DRAWER_EDGE_MARGIN_PX,
  DRAWER_KEEP_CLEAR_ATTRIBUTE,
  fitDrawerWidth,
} from "../../../model/explorer/trace-drawer/drawer-fit.ts";
import { LANGY_DRAWER_YIELD_PX } from "../../../model/langy/langy-panel-layout.ts";
import { DRAWER_MIN_WIDTH_PX } from "../../drawer-chrome.store.ts";
import { useLangyStore } from "../../langy/langy.store.ts";

const RETRY_MS = 250;
const MAX_RETRIES = 20;

function readEdge(): { element: Element; right: number } | null {
  const element = document.querySelector(`[${DRAWER_KEEP_CLEAR_ATTRIBUTE}]`);
  if (!element) return null;
  return { element, right: element.getBoundingClientRect().right };
}

/** Re-points `observer` at the control's parent, so a search-bar resize re-measures. */
function watchParent({
  observer,
  observed,
  element,
}: {
  observer: ResizeObserver | null;
  observed: Element | null;
  element: Element | undefined;
}): Element | null {
  const parent = element?.parentElement ?? null;
  if (!parent || parent === observed) return observed;
  if (observed) observer?.unobserve(observed);
  observer?.observe(parent);
  return parent;
}

type LayoutReading = { keepClearRightPx: number | null; viewportWidth: number };

/** Reports the viewport width and the kept-clear control's right edge until the stop runs. */
function followLayout(report: (reading: LayoutReading) => void): () => void {
  let observed: Element | null = null;
  let retries = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
  function measure() {
    const edge = readEdge();
    report({
      keepClearRightPx: edge ? Math.round(edge.right) : null,
      viewportWidth: window.innerWidth,
    });
    observed = watchParent({ observer, observed, element: edge?.element });
    if (edge || retries >= MAX_RETRIES) return;
    retries += 1;
    retry = setTimeout(measure, RETRY_MS);
  }
  measure();
  window.addEventListener("resize", measure);
  return () => {
    window.removeEventListener("resize", measure);
    observer?.disconnect();
    clearTimeout(retry);
  };
}

/**
 * The viewport width and the right edge of the control the drawer keeps clear, followed through
 * window and search-bar resizes; the edge is `null` while no such control is on the page.
 */
function useLayoutReading(): LayoutReading {
  const [reading, setReading] = useState<LayoutReading>(() => ({
    keepClearRightPx: null,
    viewportWidth: typeof window === "undefined" ? Infinity : window.innerWidth,
  }));
  useLayoutEffect(
    () =>
      followLayout((next) =>
        setReading((last) =>
          last.keepClearRightPx === next.keepClearRightPx &&
          last.viewportWidth === next.viewportWidth
            ? last
            : next,
        ),
      ),
    [],
  );
  return reading;
}

/**
 * The width the trace drawer renders at for the reader's preferred one: clear of Ask
 * Langy, and narrowed rather than shifted while the docked Langy panel holds the right edge.
 */
export function useFittedDrawerWidth({ preferredPx }: { preferredPx: number }): {
  widthPx: number;
  viewportWidth: number;
} {
  const isLangyDocked = useLangyStore((s) => s.isOpen && s.panelMode === "sidebar");
  const { keepClearRightPx, viewportWidth } = useLayoutReading();
  const widthPx = fitDrawerWidth({
    preferredPx,
    viewportWidth,
    rightReservePx: isLangyDocked ? LANGY_DRAWER_YIELD_PX : DRAWER_EDGE_MARGIN_PX,
    keepClearRightPx,
    minPx: DRAWER_MIN_WIDTH_PX,
  });
  return { widthPx, viewportWidth };
}

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

/** Reports the kept-clear control's right edge on every change until the returned stop runs. */
function followKeepClearEdge(report: (right: number | null) => void): () => void {
  let observed: Element | null = null;
  let retries = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
  function measure() {
    const edge = readEdge();
    report(edge ? Math.round(edge.right) : null);
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
 * The right edge of the control the drawer keeps clear, followed through window and
 * search-bar resizes; `null` while no such control is on the page.
 */
export function useKeepClearEdge(): number | null {
  const [right, setRight] = useState<number | null>(null);
  useLayoutEffect(() => followKeepClearEdge(setRight), []);
  return right;
}

/**
 * The width the trace drawer renders at for the reader's preferred one: clear of Ask
 * Langy, and narrowed rather than shifted while the docked Langy panel holds the right edge.
 */
export function useFittedDrawerWidth({
  preferredPx,
  viewportWidth,
}: {
  preferredPx: number;
  viewportWidth: number;
}): number {
  const isLangyDocked = useLangyStore((s) => s.isOpen && s.panelMode === "sidebar");
  const keepClearRightPx = useKeepClearEdge();
  return fitDrawerWidth({
    preferredPx,
    viewportWidth,
    rightReservePx: isLangyDocked ? LANGY_DRAWER_YIELD_PX : DRAWER_EDGE_MARGIN_PX,
    keepClearRightPx,
    minPx: DRAWER_MIN_WIDTH_PX,
  });
}

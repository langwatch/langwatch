/**
 * How an overlay this family does not own is addressed.
 *
 * `platform/app`'s drawer registry reads `drawer.open` plus one query parameter
 * per prop, which is what `openOverlay(request)` writes.
 *
 * THE CHROME GAP IS THIS SIDE'S. Three of the screen's actions write a
 * `?drawer.open=…` address — `onlineEvaluation` for both create and edit, and
 * `guardrails`. Both drawers are registered in `platform/app` and mounted by
 * `DashboardPageBody`, which is application chrome a screen served from
 * `apps/ui` has nothing above it to supply, so the address changes and nothing
 * opens. It is the same recorded gap five families before this one carried, and
 * this family loses the most to it: creating an online evaluation is the page's
 * primary action.
 */

import type { MonitorOverlayRequest } from "@langwatch/monitor-web/screens/online-evaluations";

export function overlayQuery(request: MonitorOverlayRequest): Record<string, string | undefined> {
  return {
    "drawer.open": request.drawer,
    ...Object.fromEntries(
      Object.entries(request.params ?? {}).map(([key, value]) => [`drawer.${key}`, value]),
    ),
  };
}

export function openMonitorOverlay({
  request,
  query,
  setQuery,
}: {
  request: MonitorOverlayRequest;
  query: Readonly<Record<string, string | undefined>>;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
  setQuery({ ...query, ...overlayQuery(request) });
}

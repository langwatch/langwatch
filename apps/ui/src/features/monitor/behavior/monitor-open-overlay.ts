/**
 * How an overlay this family does not own is addressed: `drawer.open` plus
 * one param per prop. The two drawers it names are `platform/app`-mounted
 * chrome this application doesn't yet supply — a recorded gap, not a bug.
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

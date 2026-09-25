/**
 * The overlays these pages open, as query writes.
 */

/**
 * `platform/app` used `useDrawer`, application composition a feature-web package may not reach.
 * `CurrentDrawer` actually just hydrates from `drawer.open` plus `drawer.*` params, so writing
 * the same keys is writing the same intent.
 */

/**
 * KNOWN CHROME GAP: `traceV2Details` is mounted by `DashboardPageBody` (application chrome); a
 * screen served from `apps/ui` has nothing above it yet, so nothing opens until the chrome
 * layout route lands. Writing it is still right — it comes back for free once chrome lands.
 */

/**
 * Every `drawer.` key already on the address is taken off first and everything else is left
 * alone, matching the platform registry — opening a trace from the users page leaves the range
 * and filters standing under it.
 */

/** The whole-query write the host port takes: `undefined` removes a key. */
export type AnalyticsQueryWrite = Record<string, string | undefined>;

/** Clears every `drawer.` key the current address carries. */
function withoutDrawerKeys(
  current: Readonly<Record<string, string | undefined>>,
): AnalyticsQueryWrite {
  const next: AnalyticsQueryWrite = {};
  for (const [key, value] of Object.entries(current)) {
    next[key] = key.startsWith("drawer.") ? void 0 : value;
  }
  return next;
}

/** Automation's drawer, prefilled with one graph as main's `openDrawer("automation")` was. */
export function automationDrawerAddress({
  current,
  graphId,
  automationId,
  seriesName,
}: {
  current: Readonly<Record<string, string | undefined>>;
  graphId: string;
  automationId?: string;
  seriesName?: string;
}): AnalyticsQueryWrite {
  return {
    ...withoutDrawerKeys(current),
    "drawer.open": "automation",
    "drawer.automationId": automationId,
    "drawer.prefilledGraphId": graphId,
    "drawer.prefilledSeriesName": seriesName,
  };
}

/** The trace explorer's own drawer, opened on one trace. */
export function traceDetailsAddress({
  current,
  traceId,
}: {
  current: Readonly<Record<string, string | undefined>>;
  traceId: string;
}): AnalyticsQueryWrite {
  return {
    ...withoutDrawerKeys(current),
    "drawer.open": "traceV2Details",
    "drawer.traceId": traceId,
  };
}

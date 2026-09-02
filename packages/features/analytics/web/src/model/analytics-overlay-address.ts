/**
 * The one overlay these pages open, as a query write.
 *
 * `platform/app` wrote it through `useDrawer`, which is application composition
 * a feature-web package may not reach. What a drawer actually needs is the
 * address: `CurrentDrawer` hydrates itself from `drawer.open` plus the
 * `drawer.*` parameters, so writing the same keys is writing the same intent.
 *
 * KNOWN CHROME GAP, stated here rather than papered over. `traceV2Details` is
 * registered in `platform/app` and mounted by `DashboardPageBody`, which is
 * application chrome; a screen served from `apps/ui` has nothing above it yet.
 * So on the feedback table the address changes and nothing opens until the
 * chrome layout route lands — the same gap the coding-agent, me, automations
 * and annotations families recorded. Writing the address is still right: it is
 * what makes the overlay come back for free when the chrome does, and it is
 * what a shared link already means.
 *
 * Every `drawer.` key already on the address is taken off first and everything
 * else is left alone, which is what the platform registry did — so opening a
 * trace from the users page leaves the range and the filters standing under it.
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

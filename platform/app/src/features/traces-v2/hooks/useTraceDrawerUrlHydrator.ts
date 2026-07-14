import { useEffect } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useDrawerStore } from "../stores/drawerStore";

/**
 * One-way URL → drawer store sync. Lives at the page level so the
 * `<TraceV2DrawerShell>` mount decision can read the store directly
 * (synchronous on click) instead of waiting for the URL push to
 * round-trip through React Router. Deep links + browser back/forward
 * still feed the store via this hook.
 *
 * Without this, clicking a row had to wait for `router.push` to
 * complete before `CurrentDrawer` saw `drawer.open=traceV2Details`
 * and mounted the shell — visible as a beat between click and the
 * drawer sliding in. With the store as the source of truth and the
 * URL only a serialization, the shell can mount the same render the
 * click ran in.
 */
export function useTraceDrawerUrlHydrator(): void {
  const { currentDrawer } = useDrawer();
  const params = useDrawerParams();

  useEffect(() => {
    const wantsOpen = currentDrawer === "traceV2Details";
    const traceId = params.traceId ?? null;
    const occurredAtMs = params.t ? Number(params.t) : null;
    const validTimestamp =
      occurredAtMs !== null && Number.isFinite(occurredAtMs) && occurredAtMs > 0
        ? occurredAtMs
        : null;

    const store = useDrawerStore.getState();

    if (wantsOpen && traceId) {
      if (
        store.traceId === traceId &&
        store.occurredAtMs === validTimestamp
      ) {
        return;
      }
      store.openTrace(traceId, validTimestamp);
      return;
    }

    if (!wantsOpen && store.traceId) {
      store.closeDrawer();
    }
  }, [currentDrawer, params.traceId, params.t]);
}

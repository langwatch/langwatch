/**
 * Polling cadence for the run detail drawer's getRunState query.
 *
 * A finished run never changes, so its drawer must not poll at all.
 * Live (or not-yet-visible) runs poll fast only while the SSE event stream
 * is down — when connected, SSE invalidations deliver updates and polling
 * drops to a slow safety net.
 *
 * @see specs/suites/simulations-performance.feature
 */

import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

const FAST_POLL_MS = 3000;
const SSE_FALLBACK_POLL_MS = 15_000;

const TERMINAL_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
]);

export function getRunStatePollInterval({
  status,
  sseConnected,
}: {
  /** Undefined while the run hasn't loaded yet (still queued / NOT_FOUND). */
  status: ScenarioRunStatus | undefined;
  sseConnected: boolean;
}): number | false {
  if (status !== undefined && TERMINAL_STATUSES.has(status)) return false;

  // Stalled runs only revive when new events arrive; SSE covers that.
  if (status === ScenarioRunStatus.STALLED) {
    return sseConnected ? false : SSE_FALLBACK_POLL_MS;
  }

  return sseConnected ? SSE_FALLBACK_POLL_MS : FAST_POLL_MS;
}

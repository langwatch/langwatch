/**
 * The number on the operations Dashboard entry: blocked groups plus
 * dead-lettered jobs, polled while the reader can reach the ops pages at all.
 *
 * RESTORED. The legacy chrome's `OpsSection` rendered this on its own sidebar
 * section, and that section went with the chrome — the new modes offer every
 * operations page from the settings menu instead. The count did not come with
 * it, so `ops.getBadgeCounts` was served and called by nobody, and a reader
 * with parked work waiting saw a menu that looked idle.
 *
 * Two things about the old arrangement did NOT travel, deliberately:
 *
 * - The `SHOW_OPS_IN_MAIN_SIDEBAR` allowlist. It steered the legacy sidebar,
 *   which is gone; the settings menu lists Ops on ops access alone, so the
 *   badge follows the entry it sits on.
 * - The two-tier poll. Off the ops route the legacy section asked for these
 *   two integers, and on it derived them from the full dashboard snapshot at a
 *   ten-second cadence instead. The heavy half belongs to the operations
 *   package, and reaching for it here would take a dependency ADR-004 seals;
 *   the cheap one polls everywhere instead, so on the dashboard itself the
 *   badge trails the page it sits beside by up to a minute.
 *
 * The query is gated on ops access because the procedure REFUSES rather than
 * answers empty: it is mounted behind `ops:view` as a throwing policy, not the
 * probe the menu's own gate uses.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 */

import { useNavigationHost } from "../model/navigation-host";
import { navigationApi } from "./navigation-api";

/** How often the badge re-asks. One minute, as the legacy sidebar did. */
export const OPS_ATTENTION_POLL_INTERVAL_MS = 60_000;

/**
 * The count to render, or `undefined` while there is nothing to say — no
 * access, or no answer yet. Zero is an answer and stays a number, so the
 * renderer rather than this hook decides that zero draws nothing.
 */
export function useOpsAttentionCount(): number | undefined {
  const { hasAccess } = useNavigationHost().opsAccess();
  const counts = navigationApi.ops.getBadgeCounts.useQuery(undefined, {
    enabled: hasAccess,
    refetchInterval: OPS_ATTENTION_POLL_INTERVAL_MS,
  });

  if (!hasAccess || !counts.data) return void 0;

  return counts.data.blockedCount + counts.data.dlqCount;
}

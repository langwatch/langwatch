// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { api } from "../../../behavior/governance-api.ts";
import { type Breakdowns } from "../model/breakdowns.ts";
import { isRefusedRead } from "../model/cost-sample-mode.ts";
import { type SpenderReadState } from "../ui/sections/spender-panel-slot.tsx";
import { useBreakdownQueries } from "./use-breakdown-queries.ts";

/**
 * The pulled lane's spender breakdown. Split-grant rule as the breakdowns
 * above: the spender labels are the People screen's data, so the read is
 * gated on that screen's permission — the server refuses it anyway, this
 * just spares the failed query.
 */
function useSpenderRows({
  organizationId,
  windowDays,
  enabled,
}: {
  organizationId: string;
  windowDays: number;
  enabled: boolean;
}) {
  const spenders = api.governanceCost.spenders.useQuery(
    { organizationId, windowDays },
    { enabled, refetchOnWindowFocus: false },
  );
  return {
    rows: spenders.data?.rows ?? null,
    // Carried out separately instead of collapsed into null: null is this
    // screen's word for "unanswered or absent", and a failed read is neither
    // — hiding the panel on an outage would claim nobody spent anything.
    isError: spenders.isError,
    // A decline is not an outage. Carried apart from `isError` so the panel can
    // show what it holds instead of accusing the read of breaking.
    refused: isRefusedRead(spenders.error),
    isFetching: spenders.isFetching,
    retry: () => void spenders.refetch(),
  };
}

/**
 * Every read this screen issues, and the one control that runs them again.
 *
 * One place rather than five call sites, because the guarantees this screen
 * makes are about the SET: none of them polls, none re-reads on focus, and
 * refreshing runs all of them or the screen is half up to date. A read added
 * next to its neighbours here is a read the refresh cannot silently miss.
 */
export function useCostScreenReads({
  organizationId,
  windowDays,
  hasAnyPermission,
}: {
  organizationId: string;
  windowDays: number;
  hasAnyPermission: (permission: "activityMonitor:view" | "governance:view") => boolean;
}) {
  const { summary, providerDays } = useLaneReads({
    organizationId,
    windowDays,
  });
  const breakdowns = useBreakdownQueries({
    organizationId,
    windowDays,
    // The page opens on `governanceCost:view`, but the breakdowns read the
    // activity monitor, which is its own grant. A viewer holding one and not
    // the other gets the lanes and no failed queries underneath them.
    enabled: !!organizationId && hasAnyPermission("activityMonitor:view"),
  });
  const spenders = useSpenderRows({
    organizationId,
    windowDays,
    enabled: !!organizationId && hasAnyPermission("governance:view"),
  });
  return {
    summary,
    providerDays,
    breakdowns,
    spenders,
    // EVERY read the refresh runs, not most of them. `refresh` re-runs the
    // spender read too, so leaving it out drops `aria-busy` while that one is
    // still in flight — and a reader who sees the control go quiet with the
    // panel unchanged clicks it again, which is the thing the busy state is on
    // the page to prevent.
    busy:
      summary.isFetching || providerDays.isFetching || breakdowns.isFetching || spenders.isFetching,
    refresh: () => refreshEveryRead({ summary, providerDays, spenders, breakdowns }),
  };
}

/**
 * The two reads the lanes and the day split are drawn from.
 *
 * Neither polls and neither re-reads when the reader returns to the window.
 * That rule is stated HERE, at each call site, rather than inherited from the
 * global query defaults: another governance screen already overrides that
 * global to re-read on focus, so a money read that does not say the rule
 * itself is one edit away from polling by accident — and the edit would be
 * made in a different file by somebody with no reason to think about this
 * screen. Figures that move under a reader mid-decision, often with the window
 * shared, are worse than figures they chose to bring up to date.
 */
function useLaneReads({
  organizationId,
  windowDays,
}: {
  organizationId: string;
  windowDays: number;
}) {
  const options = {
    enabled: !!organizationId,
    refetchOnWindowFocus: false as const,
  };
  const args = { organizationId, windowDays };
  return {
    summary: api.governanceCost.summary.useQuery(args, options),
    providerDays: api.governanceCost.dailyByProvider.useQuery(args, options),
  };
}

/**
 * Bringing every figure on this screen up to date, by name.
 *
 * The set is NAMED rather than counted. The collection warning rides the
 * summary read and the figures ride the others, and a figure brought up to
 * date beside a stalled warning that was not is a worse screen than one where
 * both are old together — so the absence of any single name here is a screen
 * that half-refreshes, and a count would not say which one went missing.
 *
 * Each read is asked to run again directly rather than having its cache key
 * invalidated. Both reissue the read; asking the query objects this screen
 * already holds keeps the list of what gets refreshed in the same place as the
 * list of what gets read, where a new read added to one and forgotten in the
 * other is visible.
 *
 * The records behind a day are deliberately absent: that read is issued only
 * once a reader opens a day, and re-running a read nothing is showing would be
 * work for nobody.
 */
function refreshEveryRead({
  summary,
  providerDays,
  spenders,
  breakdowns,
}: {
  summary: { refetch: () => unknown };
  providerDays: { refetch: () => unknown };
  spenders: SpenderReadState;
  breakdowns: Breakdowns;
}) {
  summary.refetch();
  providerDays.refetch();
  spenders.retry();
  breakdowns.refetchAll();
}

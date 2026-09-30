// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  deriveSourceHealth,
  type RunCompleteness,
} from "@ee/governance/services/pullers/sourceHealth";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleX,
} from "lucide-react";

/**
 * Health is derived at read time from the failure count below, so it only
 * changes when a pull actually runs — and pulls run on the server's own
 * schedule, never in response to anything this page does. Without a periodic
 * refetch the badge keeps whatever it had at mount, so an admin who has just
 * repaired a source's credentials watches a red badge that is already stale,
 * and a source that started failing while the tab was open never turns red at
 * all.
 *
 * Background polling stays off, because that reader is the only one this is
 * for: an inventory tab left open behind other windows would otherwise keep
 * an org-wide health query running for nobody. Focus is the cheap catch-up
 * for the interval the hidden tab skipped.
 */
export const SOURCE_HEALTH_REFRESH = {
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;

/**
 * What the source badge says, on the inventory list and the detail header.
 *
 * Two different questions share one badge. Status is what an admin
 * configured: active, disabled, waiting for its first event. Health is
 * whether the puller still works, derived at read time from the consecutive
 * failure count (ADR-128) -- never stored as a fourth status, because a
 * provider outage must not be able to rewrite configuration.
 *
 * Health wins when the two disagree, with one exception. A source configured
 * "active" whose last three runs all failed is not active in the sense any
 * reader means, and showing the green check there is how a broken integration
 * goes unnoticed for a week.
 *
 * The exception is "disabled". A disabled source is not expected to be
 * pulling, so "Pulls failing" is not news about it — it is the state an admin
 * chose, restated in red. Worse, it is unactionable: the reader clicks
 * through to fix an outage and finds nothing wrong. Configuration wins here
 * because health is only interesting about a source we are asking to run.
 */
export interface SourceBadge {
  icon: typeof CircleCheck;
  label: string;
  color: string;
}

export const SOURCE_STATUS_META: Record<string, SourceBadge> = {
  active: { icon: CircleCheck, label: "Active", color: "green.500" },
  awaiting_first_event: {
    icon: CircleDashed,
    label: "Awaiting first event",
    color: "amber.500",
  },
  disabled: { icon: CircleX, label: "Disabled", color: "fg.muted" },
};

export const SOURCE_UNHEALTHY_META: SourceBadge = {
  icon: CircleAlert,
  label: "Pulls failing",
  color: "red.500",
};

/**
 * A source whose last run stopped before it had read everything.
 *
 * A third answer, because the other two are both wrong about it. It is not
 * failing -- a page limit and a deadline end a run with nothing to report as
 * an error -- and it is not active in the sense a reader takes from the green
 * check, which they read as "the numbers below are the whole picture".
 */
export const SOURCE_PARTIAL_META: SourceBadge = {
  icon: CircleDotDashed,
  label: "Partly collected",
  color: "amber.500",
};

/**
 * The stored completeness column as the two answers the badge understands.
 *
 * The column is a plain string, so anything that is neither answer — a row
 * written before this existed, a value from a future producer this build does
 * not know — becomes null and reads as unknown. Guessing either way is how a
 * half-read source starts reading as fully collected.
 */
export function runCompleteness(stored: string | null): RunCompleteness | null {
  return stored === "complete" || stored === "truncated" ? stored : null;
}

export function sourceBadge({
  status,
  errorCount,
  completeness,
}: {
  status: string;
  errorCount: number;
  /** Whether the last run drained the period it was asked for, when known. */
  completeness?: RunCompleteness | null;
}): SourceBadge {
  // Checked before health: a source nobody asked to run cannot be failing to
  // run, so its configured state is the honest badge.
  if (status === "disabled") return SOURCE_STATUS_META.disabled!;
  // Failing outranks partly collected. A source doing both is one an admin
  // has to go and fix, and a run that stopped early is the milder half of
  // that news -- shown on its own it reads as a source that is working.
  if (deriveSourceHealth({ consecutiveFailures: errorCount }) === "unhealthy") {
    return SOURCE_UNHEALTHY_META;
  }
  if (completeness === "truncated") return SOURCE_PARTIAL_META;
  // Own-property test, not a bare lookup. `status` is a free-form column, and
  // an object literal answers "toString" or "constructor" with an inherited
  // Function, which `??` does not treat as missing -- the badge would come back
  // as a Function, `.icon` would be undefined, and rendering an undefined
  // component throws. Every genuinely unknown word already falls through here
  // correctly; only the handful of inherited names misbehave, which is exactly
  // why a test picking a well-behaved word cannot see it.
  return Object.hasOwn(SOURCE_STATUS_META, status)
    ? SOURCE_STATUS_META[status]!
    : SOURCE_STATUS_META.awaiting_first_event!;
}

/**
 * Re-exported from the health rule it belongs with. The badge and the cost
 * screen ask the same question, and the cost service cannot import this
 * module — it brings icons with it.
 */
export { noDataSinceNotice } from "@ee/governance/services/pullers/sourceHealth";

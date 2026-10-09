// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AggregateRule } from "@langwatch/project-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

/** Where a member's shared read starts (ADR-177 decision 3): all of its history, or its join. */
export type AggregateReadWindow = "full-history" | "since-attach";

/** A full-history read starts at the epoch; an absent `from` would drop the member instead. */
export const FULL_HISTORY_FROM = Temporal.Instant.fromEpochMilliseconds(0).toString();

/** A shared read the aggregate holds, by member, with the start of its stored window. */
type HeldAggregateRead = { memberProjectId: string; from: string | null };

/** What one reconcile of an aggregate writes: members to attach, reads to revoke, the rest. */
type AggregateMembershipDecision = {
  attach: string[];
  /** Members still wanted whose read starts at the wrong moment: revoked, then attached again. */
  reattach: string[];
  revoke: string[];
  unchanged: string[];
};

/** A department rule keeps the join date: a move must not show the new department the old past. */
export function aggregateReadWindowOf(kind: AggregateRule["kind"]): AggregateReadWindow {
  switch (kind) {
    case "all-personal":
    case "explicit":
      return "full-history";
    case "personal-by-department":
      return "since-attach";
  }
}

/** The `from` a new read is attached with: the epoch for full history, otherwise now. */
export function aggregateReadStart({
  window,
  now,
}: {
  window: AggregateReadWindow;
  now: string;
}): string {
  return window === "full-history" ? FULL_HISTORY_FROM : now;
}

/** Any attach-time start is right for a since-attach read, so a correct one is never rewritten. */
function startsRight({ from, window }: { from: string | null; window: AggregateReadWindow }) {
  if (from === null) return false;
  const startMs = toEpochMs(from);
  if (!Number.isFinite(startMs)) return false;
  return window === "full-history" ? startMs === 0 : startMs !== 0;
}

/**
 * ADR-177 decision 3: the members an aggregate's rule selects against the reads it holds now.
 * The aggregate is never its own member; each list is sorted, so a second run decides nothing new.
 */
export function decideAggregateMembership({
  aggregateProjectId,
  desired,
  held,
  window,
}: {
  aggregateProjectId: string;
  desired: readonly string[];
  held: readonly HeldAggregateRead[];
  window: AggregateReadWindow;
}): AggregateMembershipDecision {
  const wanted = new Set(desired.filter((id) => id !== aggregateProjectId));
  const holding = new Map(held.map((read) => [read.memberProjectId, read.from]));
  const kept = [...holding].filter(([id]) => wanted.has(id));
  return {
    attach: [...wanted].filter((id) => !holding.has(id)).toSorted(),
    reattach: kept
      .filter(([, from]) => !startsRight({ from, window }))
      .map(([id]) => id)
      .toSorted(),
    revoke: [...holding.keys()].filter((id) => !wanted.has(id)).toSorted(),
    unchanged: kept
      .filter(([, from]) => startsRight({ from, window }))
      .map(([id]) => id)
      .toSorted(),
  };
}

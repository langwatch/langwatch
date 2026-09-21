/**
 * Which state a governance sync control is in, and — when it cannot be pressed
 * — WHICH unpressable it is.
 *
 * Pure, and deliberately wordless. The reasons a control is unavailable are
 * the same three on every governance page and the sentences that explain them
 * are not: "no connected provider can list agents" and the same claim about
 * people are different sentences, and a shared module holding both would hold
 * a noun parameter and a sentence built by concatenation. So this returns the
 * CAUSE and each page maps it to its own words, which is the split
 * `GovernanceEmptyStateCopy` already makes for empty states.
 */

import type { GovernanceSyncState } from "./GovernanceSyncButton";

/**
 * Why a control cannot be pressed:
 *   `no_grant`    — the reader lacks the grant that lets them ask.
 *   `checking`    — the read of which providers can be asked is in flight.
 *   `no_provider` — nothing connected can answer this question.
 */
export type GovernanceSyncUnavailable = "no_grant" | "checking" | "no_provider";

export type GovernanceSyncStatus =
  | { state: Exclude<GovernanceSyncState, "unavailable"> }
  | { state: "unavailable"; because: GovernanceSyncUnavailable };

/**
 * The order of the checks is the order of the reader's questions. Whether a
 * request is in flight beats everything, because it is the most recent thing
 * they did, and whether one was already made beats the rest for the same
 * reason. The grant is checked ahead of the sources because a reader who
 * cannot press it does not need to know how many providers they have.
 */
export function governanceSyncStatus({
  canManage,
  isLoadingSources,
  sourceCount,
  isAsking,
  hasAsked,
}: {
  canManage: boolean;
  isLoadingSources: boolean;
  sourceCount: number;
  isAsking: boolean;
  /** A request was recorded in this page's lifetime. */
  hasAsked: boolean;
}): GovernanceSyncStatus {
  if (isAsking) return { state: "asking" };
  if (hasAsked) return { state: "asked" };
  if (!canManage) return { state: "unavailable", because: "no_grant" };
  if (isLoadingSources) return { state: "unavailable", because: "checking" };
  if (sourceCount === 0) {
    return { state: "unavailable", because: "no_provider" };
  }
  return { state: "ready" };
}

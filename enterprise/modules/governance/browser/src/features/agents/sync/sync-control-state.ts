/**
 * Which state a governance sync control is in, and which unpressable one. Pure and wordless: it
 * returns the CAUSE and each page maps it to its own sentence, like `GovernanceEmptyStateCopy`.
 */

import type { GovernanceSyncState } from "./governance-sync-button";

/**
 * Why a control cannot be pressed: `no_grant` — the reader lacks the grant that lets them ask.
 * `checking` — the read of which providers can be asked is in flight. `no_provider` — nothing
 * connected can answer this question.
 */
export type GovernanceSyncUnavailable = "no_grant" | "checking" | "no_provider";

export type GovernanceSyncStatus =
  | { state: Exclude<GovernanceSyncState, "unavailable"> }
  | { state: "unavailable"; because: GovernanceSyncUnavailable };

/**
 * Checks run in the order of the reader's questions: in-flight first, then already-asked, then the
 * grant, then the sources.
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

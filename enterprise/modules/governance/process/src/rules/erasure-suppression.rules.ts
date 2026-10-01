// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One (organization, provider)'s suppression answer, resolved per pull run, asked per event. */
export interface ErasureSuppressionCheck {
  isSuppressed(identifier: string): boolean;
  /** Whether anything is suppressed at all — the usual answer is nothing. */
  readonly isEmpty: boolean;
}

/** A check that suppresses nothing, for every path with nothing to suppress. */
export const NO_SUPPRESSION: ErasureSuppressionCheck = {
  isSuppressed: () => false,
  isEmpty: true,
};

/** What one batch kept, and how much of it the erasure list held back. */
export interface SuppressionPartition<T> {
  kept: T[];
  suppressedCount: number;
}

/** Drops a suppressed item rather than scrubbing it later: the identifier rides in three places. */
export function partitionSuppressedEvents<T>({
  events,
  actorOf,
  suppression,
}: {
  events: readonly T[];
  actorOf: (event: T) => string;
  suppression: ErasureSuppressionCheck;
}): SuppressionPartition<T> {
  if (suppression.isEmpty) return { kept: [...events], suppressedCount: 0 };
  const kept = events.filter((event) => !suppression.isSuppressed(actorOf(event)));
  return { kept, suppressedCount: events.length - kept.length };
}

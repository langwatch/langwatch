import type { RetentionCategory } from "@langwatch/data-retention-contract";
import { nowInstant } from "@langwatch/time";

import type { StoredPastRetentionOwners } from "../../channels/data-retention.channels.ts";

const DAY_MS = 86_400_000;

/** One stored item, by its age and the period its rows are stamped with (0 keeps it forever). */
export type StoredPastRetentionItem = { ageDays: number; retentionDays: number };

/** Every owning module answering that nothing is past any period, for tests not about the count. */
export function emptyStoredPastRetentionOwners(): StoredPastRetentionOwners {
  const none = { countStoredPastRetention: async () => 0 };
  return { traces: none, scenarios: none, experiments: none };
}

/**
 * Owners answering from the items a test stores, keyed `project/category`: an item counts when it
 * is older than the cutoff and kept forever or longer than the period, as the owners' reads do.
 */
export function storedPastRetentionOwnersOf(
  items: ReadonlyMap<string, readonly StoredPastRetentionItem[]>,
): StoredPastRetentionOwners {
  const owner = (category: RetentionCategory) => ({
    countStoredPastRetention: async (input: {
      projectId: string;
      beforeMs: number;
      retentionDays: number;
    }) =>
      (items.get(`${input.projectId}/${category}`) ?? []).filter(
        (item) =>
          nowInstant().epochMilliseconds - item.ageDays * DAY_MS < input.beforeMs &&
          (item.retentionDays === 0 || item.retentionDays > input.retentionDays),
      ).length,
  });
  return {
    traces: owner("traces"),
    scenarios: owner("scenarios"),
    experiments: owner("experiments"),
  };
}

import type { StoredBytesOwners } from "../../channels/data-retention.channels.ts";

/** Every owning module answering that the project stores nothing, for tests not about the meter. */
export function emptyStoredBytesOwners(): StoredBytesOwners {
  const empty = { getStoredBytes: async () => 0 };
  return {
    traces: empty,
    logs: empty,
    evaluations: empty,
    experiments: empty,
    scenarios: empty,
    suites: empty,
    langy: empty,
  };
}

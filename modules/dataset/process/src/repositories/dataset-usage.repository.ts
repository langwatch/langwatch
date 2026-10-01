import type { DatasetUsageCount } from "@langwatch/dataset-contract";

/** The usage report's reads of this feature's own tables: counts and first days only. */
export interface DatasetUsageRepository {
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount>;
}

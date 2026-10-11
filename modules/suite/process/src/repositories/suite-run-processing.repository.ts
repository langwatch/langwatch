import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

/** The store the suite-run fold reads and writes, opened once the retention default is known. */
export interface SuiteRunProcessingRepository {
  openRunStateFoldStore(input: {
    defaultRetentionDays: () => number;
    /** Whether this module's id index is filled; absent reads a run with no time bound. */
    idIndex?: IdIndexFlags | undefined;
  }): FoldProjectionStore<SuiteRunStateData>;
  /** One tenant's suite runs not yet finished (PENDING or IN_PROGRESS), latest state each. */
  findOpenRuns(input: { tenantId: string }): Promise<SuiteRunStateData[]>;
}

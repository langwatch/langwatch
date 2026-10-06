import type { FoldProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

/** The store the suite-run fold reads and writes, opened once the retention default is known. */
export interface SuiteRunProcessingRepository {
  openRunStateFoldStore(input: {
    defaultRetentionDays: () => number;
  }): FoldProjectionStore<SuiteRunStateData>;
}

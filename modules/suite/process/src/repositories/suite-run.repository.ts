import type {
  SuiteBatchHistoryInput,
  SuiteRunStateData,
  SuiteRunStateInput,
} from "@langwatch/suite-contract";

/** Read-only access to the event-driven Suite run projection. */
export abstract class SuiteRunReadRepository {
  abstract findSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null>;
  abstract findBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]>;
}

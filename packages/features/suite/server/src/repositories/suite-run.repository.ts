import type {
  SuiteBatchHistoryInput,
  SuiteRunStateData,
  SuiteRunStateInput,
} from "@langwatch/suite-contract";

/** Read-only access to the event-driven Suite run projection. */
export abstract class SuiteRunReadRepository {
  abstract getSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null>;
  abstract getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]>;
}

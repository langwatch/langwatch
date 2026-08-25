import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "@langwatch/eventing";
import type {
  SuiteBatchHistoryInput,
  SuiteRunStateData,
  SuiteRunStateInput,
} from "@langwatch/suite-contract";

/** Private persistence port for both the Suite fold and its read model. */
export abstract class SuiteRunRepository implements ProjectionStore<Projection<SuiteRunStateData>> {
  abstract getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<Projection<SuiteRunStateData> | null>;
  abstract storeProjection(
    projection: Projection<SuiteRunStateData>,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
  abstract storeProjectionBatch(
    projections: Projection<SuiteRunStateData>[],
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
  abstract getSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null>;
  abstract getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]>;
}

import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../";

export interface ExperimentRunStateRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * The projection together with the ids of the events already folded into it.
   *
   * The fold's counters (`Progress`, `CompletedCount`, `TotalScoreSum`, …) are
   * accumulators, so the executor must be able to recognise a redelivered
   * event and skip it. `CachedFoldStore` keeps that set on its cache entry;
   * this is the durable copy, so a retry that reaches a COLD cache can still
   * recognise a batch it already committed (ADR-066).
   *
   * Rows written before the `AppliedEventIds` column existed read back as an
   * empty set, which reproduces the pre-column behaviour exactly: nothing is
   * suppressed, the fold blindly re-applies. That is a degradation, not a
   * corruption, and it ages out with retention.
   */
  getProjectionWithApplied(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<{ projection: ProjectionType | null; appliedEventIds: string[] }>;

  /**
   * @param appliedEventIds - the executor's dedup watermark, persisted next to
   *   the row. Omitted by callers outside the fold path (replay, backfills),
   *   which write no watermark rather than an empty one.
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
    appliedEventIds?: readonly string[],
  ): Promise<void>;
}

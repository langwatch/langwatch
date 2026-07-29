import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { ExperimentRunStateRepository } from "../repositories/experimentRunState.repository";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import { parseExperimentRunKey } from "../utils/compositeKey";
import type {
  ExperimentRunState,
  ExperimentRunStateData,
} from "./experimentRunState.foldProjection";

/**
 * Creates a FoldProjectionStore for experiment run state.
 * Dumb read/write — state IS the data.
 */
export function createExperimentRunStateFoldStore(
  repository: ExperimentRunStateRepository,
): FoldProjectionStore<ExperimentRunStateData> {
  /**
   * State together with the ids already folded into it.
   *
   * This fold accumulates — `Progress`/`CompletedCount`/`FailedCount` are
   * `+= 1` per delivered target result, and `TotalScoreSum`/`ScoreCount`/
   * `PassedCount`/`GradedCount` per evaluator result — so re-applying a
   * redelivered event double-counts. `CachedFoldStore` normally answers from
   * its cache entry's applied-set and the executor skips the redelivery; this
   * is the durable copy it falls through to when that cache is cold, which is
   * the only window in which the counters could ever drift (ADR-066,
   * migration 00064).
   *
   * No version gate here, unlike the codingAgentSession store: every column
   * this projection reads back predates the change, so an old row decodes to
   * exactly what it always did. Only the watermark is new, and its absence
   * reads as `[]` — the pre-migration behaviour, not a fabricated value.
   *
   * Declared as a named function rather than inline so `get` can delegate to it
   * without reaching through `this` on the returned object literal.
   */
  async function getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: ExperimentRunStateData | null;
    appliedEventIds: string[];
  }> {
    const { projection, appliedEventIds } =
      await repository.getProjectionWithApplied(aggregateId, {
        tenantId: context.tenantId,
      });

    return {
      state: (projection?.data as ExperimentRunStateData) ?? null,
      appliedEventIds,
    };
  }

  return {
    /**
     * Keys the fold cache, so a version bump misses rather than serving state
     * written in the old shape.
     */
    projectionVersion: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,

    async store(
      state: ExperimentRunStateData,
      context: ProjectionStoreContext,
    ): Promise<void> {
      // Extract raw experimentId and runId from the composite aggregate key
      // so that RunId and ExperimentId are always populated consistently,
      // even before the "started" event sets them via apply().
      // This prevents the split-row bug where ExperimentId mutates from ""
      // to the real value between writes.
      const { experimentId, runId } = parseExperimentRunKey(
        context.aggregateId,
      );
      const stateWithKeys: ExperimentRunStateData = {
        ...state,
        RunId: runId,
        ExperimentId: experimentId,
      };
      const projectionId = context.aggregateId;

      const projection: ExperimentRunState = {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
        data: stateWithKeys,
      };

      await repository.storeProjection(
        projection,
        {
          tenantId: context.tenantId,
          // `experiment_runs` is a retention-managed table in the `experiments`
          // category, and the repository reads its day count from here. Omit it
          // and the repository's `?? PLATFORM_DEFAULT_RETENTION_DAYS` fallback
          // fires on every write, so the run header ages on the platform
          // schedule while `experiment_run_items` — written from the same
          // delivery, through `retentionDaysFrom(context, "experiments")` —
          // ages on the tenant's. Same shape `RepositoryFoldStore` passes for
          // the scenario pipeline's `simulation_runs`.
          metadata: context.retentionPolicy
            ? { retentionPolicy: context.retentionPolicy }
            : undefined,
        },
        // The executor's redelivery-dedup watermark, persisted next to the row
        // so a retry with a cold cache still recognises a batch it committed.
        context.appliedEventIds ?? [],
      );
    },

    getWithApplied,

    /** State only; delegates so the two read paths cannot diverge. */
    async get(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<ExperimentRunStateData | null> {
      return (await getWithApplied(aggregateId, context)).state;
    },
  };
}

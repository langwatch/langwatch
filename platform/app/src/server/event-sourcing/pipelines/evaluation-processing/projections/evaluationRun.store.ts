import type { EvaluationRunRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.repository";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  type FoldReadAuthorizer,
  foldReadPurpose,
} from "../../trace-processing/projections/foldReadAuthorization";

/**
 * Thin FoldProjectionStore adapter for evaluation runs.
 * Delegates directly to EvaluationRunRepository (no mapper needed — projection uses camelCase types).
 *
 * Writes name the tenant from the store context. The read-back is fenced by
 * a proof (ADR-144 block F): the store asks `authorize` for an own-only one
 * on the context's tenant, the way the trace summary store does, so the fold
 * reads back exactly the row it wrote.
 */
export class EvaluationRunStore
  implements FoldProjectionStore<EvaluationRunData>
{
  private readonly repo: EvaluationRunRepository;
  private readonly authorize: FoldReadAuthorizer;

  constructor({
    repository,
    authorize,
  }: {
    repository: EvaluationRunRepository;
    authorize: FoldReadAuthorizer;
  }) {
    this.repo = repository;
    this.authorize = authorize;
  }

  async store(
    state: EvaluationRunData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const stateWithId = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.upsert(
      stateWithId,
      String(context.tenantId),
      retentionDays,
    );
  }

  async storeBatch(
    entries: Array<{
      state: EvaluationRunData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const batchEntries = entries.map(({ state, context }) => ({
      data: state.evaluationId
        ? state
        : { ...state, evaluationId: String(context.aggregateId) },
      tenantId: String(context.tenantId),
      retentionDays:
        context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    }));

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchEntries);
    } else {
      await Promise.all(
        batchEntries.map(({ data, tenantId, retentionDays }) =>
          this.repo.upsert(data, tenantId, retentionDays),
        ),
      );
    }
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<EvaluationRunData | null> {
    return await this.repo.getByEvaluationId({
      authorization: await this.authorize({
        projectId: String(context.tenantId),
        purpose: foldReadPurpose({ context, entry: "EvaluationRunStore.get" }),
      }),
      evaluationId: aggregateId,
    });
  }
}

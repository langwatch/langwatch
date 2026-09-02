import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { EvaluationRunProjectionPort } from "../../ports/evaluation-run-projection.port";

/** Stores Evaluation's folded runs through the three-method run projection. */
export class EvaluationRunStore implements FoldProjectionStore<EvaluationRunData> {
  static create({
    service,
    defaultRetentionDays,
  }: {
    service: EvaluationRunProjectionPort;
    defaultRetentionDays: number;
  }): EvaluationRunStore {
    return new EvaluationRunStore(service, defaultRetentionDays);
  }

  private constructor(
    private readonly service: EvaluationRunProjectionPort,
    private readonly defaultRetentionDays: number,
  ) {}

  async store(state: EvaluationRunData, context: ProjectionStoreContext): Promise<void> {
    const data = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays;
    await this.service.upsertRun({
      data,
      tenantId: String(context.tenantId),
      retentionDays,
    });
  }

  async storeBatch(
    entries: Array<{
      state: EvaluationRunData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    await this.service.upsertRuns(
      entries.map(({ state, context }) => ({
        data: state.evaluationId ? state : { ...state, evaluationId: String(context.aggregateId) },
        tenantId: String(context.tenantId),
        retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays,
      })),
    );
  }

  get(aggregateId: string, context: ProjectionStoreContext): Promise<EvaluationRunData | null> {
    return this.service.tryGetRunByEvaluationId({
      tenantId: String(context.tenantId),
      evaluationId: aggregateId,
    });
  }
}

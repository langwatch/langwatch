import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import {
  type FoldProjectionStore,
  type FoldReadAuthorizer,
  type ProjectionStoreContext,
  type FoldStateRead,
  foldReadPurpose,
} from "@langwatch/eventing";

import type { EvaluationRunProjectionRepository } from "../repositories/evaluation-run-projection.repository.ts";

/** Stores Evaluation's folded runs; the read-back is fenced by an own-only proof. */
export class EvaluationRunStore implements FoldProjectionStore<EvaluationRunData> {
  static create({
    service,
    defaultRetentionDays,
    authorize,
  }: {
    service: EvaluationRunProjectionRepository;
    defaultRetentionDays: () => number;
    authorize: FoldReadAuthorizer;
  }): EvaluationRunStore {
    return new EvaluationRunStore(service, defaultRetentionDays, authorize);
  }

  private constructor(
    private readonly service: EvaluationRunProjectionRepository,
    private readonly defaultRetentionDays: () => number,
    private readonly authorize: FoldReadAuthorizer,
  ) {}

  async store(state: EvaluationRunData, context: ProjectionStoreContext): Promise<void> {
    const data = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays();
    await this.service.upsertRun({
      data,
      tenantId: String(context.tenantId),
      retentionDays,
    });
  }

  async storeBatch(
    entries: {
      state: EvaluationRunData;
      context: ProjectionStoreContext;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;

    await this.service.upsertRuns(
      entries.map(({ state, context }) => ({
        data: state.evaluationId ? state : { ...state, evaluationId: String(context.aggregateId) },
        tenantId: String(context.tenantId),
        retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays(),
      })),
    );
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<EvaluationRunData>> {
    const folded = await this.service.findRunByEvaluationId({
      authorization: await this.authorize({
        projectId: String(context.tenantId),
        purpose: foldReadPurpose({ context, entry: "EvaluationRunStore.get" }),
      }),
      evaluationId: aggregateId,
    });
    return folded === null ? { kind: "empty" } : { kind: "folded", state: folded };
  }
}

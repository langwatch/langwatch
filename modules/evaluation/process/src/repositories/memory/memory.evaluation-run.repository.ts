import {
  EvaluationNotFoundError,
  evaluationSummarySchema,
  traceEvaluationDataSchema,
  type EvaluationInputsQuery,
  type EvaluationRunData,
  type EvaluationRunsByTraceQuery,
  type EvaluationSummariesByTraceIdsQuery,
  type EvaluationSummary,
  type TraceEvaluationData,
  type TraceEvaluationsQuery,
} from "@langwatch/evaluation-contract";

import { DEFAULT_SCHEDULED_AT_SLACK_MS } from "../../rules/evaluation-run-lookup.rules.ts";
import {
  EvaluationRunRepository,
  type EvaluationRunFloorLookup,
} from "../evaluation.repository.ts";

/** `evaluation_runs` over a map: each run's newest version wins, as the dedup read does. */
export class MemoryEvaluationRunRepository extends EvaluationRunRepository {
  readonly #runs = new Map<string, EvaluationRunData>();

  static create(): MemoryEvaluationRunRepository {
    return new MemoryEvaluationRunRepository();
  }

  private constructor() {
    super();
  }

  async upsert(input: { data: EvaluationRunData; tenantId: string }): Promise<void> {
    const key = `${input.tenantId}\u0000${input.data.evaluationId}`;
    const current = this.#runs.get(key);
    if (current && current.updatedAt > input.data.updatedAt) return;

    this.#runs.set(key, input.data);
  }

  async upsertBatch(input: { data: EvaluationRunData; tenantId: string }[]): Promise<void> {
    for (const entry of input) await this.upsert(entry);
  }

  async getByEvaluationId(input: EvaluationRunFloorLookup): Promise<EvaluationRunData> {
    const run = this.#runs.get(`${input.tenantId}\u0000${input.evaluationId}`);
    const from = input.scheduledAt
      ? input.scheduledAt.getTime() - (input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS)
      : await input.retentionFloor.getFloorMs({
          table: "evaluation_runs",
          tenantId: input.tenantId,
        });
    const to = input.scheduledAt
      ? input.scheduledAt.getTime() + (input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS)
      : Number.POSITIVE_INFINITY;
    if (!run || run.scheduledAt === null || run.scheduledAt < from || run.scheduledAt > to) {
      throw new EvaluationNotFoundError(input.evaluationId);
    }

    return run;
  }

  async findByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]> {
    return this.#tenantRuns(input.tenantId)
      .filter((run) => run.traceId === input.traceId)
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  }

  async findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>> {
    const output: Record<string, EvaluationSummary[]> = {};
    const runs = this.#tenantRuns(input.tenantId)
      .filter((run) => run.scheduledAt !== null && run.scheduledAt >= input.since)
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
    for (const run of runs) {
      if (!run.traceId || !input.traceIds.includes(run.traceId)) continue;
      (output[run.traceId] ??= []).push(
        evaluationSummarySchema.parse({
          evaluationId: run.evaluationId,
          evaluatorId: run.evaluatorId,
          evaluatorType: run.evaluatorType,
          evaluatorName: run.evaluatorName,
          traceId: run.traceId,
          isGuardrail: run.isGuardrail,
          status: run.status,
          score: run.score,
          passed: run.passed,
          label: run.label,
        }),
      );
    }
    return output;
  }

  async findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>> {
    if (input.traceIds.length === 0) return {};
    const output = Object.fromEntries(
      input.traceIds.map((traceId): [string, TraceEvaluationData[]] => [traceId, []]),
    );
    for (const run of this.#tenantRuns(input.tenantId)) {
      if (!run.traceId || !input.traceIds.includes(run.traceId)) continue;
      (output[run.traceId] ??= []).push(
        traceEvaluationDataSchema.parse({
          evaluationId: run.evaluationId,
          evaluatorId: run.evaluatorId,
          evaluatorType: run.evaluatorType,
          evaluatorName: run.evaluatorName,
          traceId: run.traceId,
          isGuardrail: run.isGuardrail,
          status: run.status,
          score: run.score,
          passed: run.passed,
          label: run.label,
          details: run.details,
          error: run.error,
          inputs: run.inputs,
          timestamps: {
            scheduledAt: run.scheduledAt,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          },
        }),
      );
    }
    return output;
  }

  async findInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null> {
    return this.#runs.get(`${input.tenantId}\u0000${input.evaluationId}`)?.inputs ?? null;
  }

  #tenantRuns(tenantId: string): EvaluationRunData[] {
    return [...this.#runs.entries()]
      .filter(([key]) => key.startsWith(`${tenantId}\u0000`))
      .map(([, run]) => run);
  }
}

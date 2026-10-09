import type { Authorization } from "@langwatch/authorization";
import { fenceFor, type TenantFence } from "@langwatch/authorization/tenant-fence";
import type {
  EvaluationRunData,
  EvaluationSummary,
  TraceEvaluationData,
} from "@langwatch/evaluation-contract";

import { TraceEvaluationRunsReadRepository } from "../trace-evaluation-runs.repository.ts";

/** A run as a test seeds it, with the tenant that recorded it; already its latest version. */
type SeededRun = EvaluationRunData & { readonly tenantId: string };

/** Whether the fence reads this run, windowed on `scheduledAt` as the ClickHouse fence is. */
function fenceAdmits({ fence, run }: { fence: TenantFence; run: SeededRun }): boolean {
  if (fence.own.includes(run.tenantId)) return true;
  const atMs = run.scheduledAt ?? 0;
  return fence.shared.some(
    (window) =>
      window.projectId === run.tenantId &&
      atMs >= window.from &&
      (window.until === null || atMs < window.until),
  );
}

/**
 * Evaluation's shared run rows in memory, seeded by a test; trace writes none. Read through the
 * proof's fence (ADR-175), like the ClickHouse twin.
 */
export class MemoryTraceEvaluationRunsRepository extends TraceEvaluationRunsReadRepository {
  static create({
    runs = [],
  }: { runs?: readonly SeededRun[] } = {}): MemoryTraceEvaluationRunsRepository {
    return new MemoryTraceEvaluationRunsRepository(runs);
  }

  private constructor(private readonly runs: readonly SeededRun[]) {
    super();
  }

  async findRunsByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    return this.#fenced(input.authorization)
      .filter((run) => run.traceId === input.traceId)
      .map(({ tenantId: _tenantId, ...run }) => run);
  }

  async findSummariesByTraceIds(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    since: number;
  }): Promise<Record<string, EvaluationSummary[]>> {
    const output: Record<string, EvaluationSummary[]> = {};
    for (const run of this.#within(input)) {
      if ((run.scheduledAt ?? 0) < input.since || !run.traceId) continue;
      (output[run.traceId] ??= []).push({
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
      });
    }
    return output;
  }

  async findTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<Record<string, TraceEvaluationData[]>> {
    const output = Object.fromEntries(
      input.traceIds.map((traceId) => [traceId, [] as TraceEvaluationData[]]),
    );
    for (const run of this.#within(input)) {
      if (!run.traceId) continue;
      (output[run.traceId] ??= []).push({
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
      });
    }
    return output;
  }

  #fenced(authorization: Authorization): SeededRun[] {
    const fence = fenceFor({ authorization, reads: "traces" });
    return this.runs.filter((run) => fenceAdmits({ fence, run }));
  }

  #within(input: { authorization: Authorization; traceIds: readonly string[] }): SeededRun[] {
    const wanted = new Set(input.traceIds);
    return this.#fenced(input.authorization).filter(
      (run) => run.traceId !== null && wanted.has(run.traceId),
    );
  }
}

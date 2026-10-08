import {
  EvaluationNotFoundError,
  type EvaluationInputsQuery,
  type EvaluationRunData,
  type EvaluationRunsByTraceQuery,
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
    // No partitions to prune and no TTL: only ClickHouse floors an unscheduled lookup.
    const from = input.scheduledAt
      ? input.scheduledAt.getTime() - (input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS)
      : Number.NEGATIVE_INFINITY;
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

  async findInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null> {
    return this.#runs.get(`${input.tenantId}\u0000${input.evaluationId}`)?.inputs ?? null;
  }

  #tenantRuns(tenantId: string): EvaluationRunData[] {
    return [...this.#runs.entries()]
      .filter(([key]) => key.startsWith(`${tenantId}\u0000`))
      .map(([, run]) => run);
  }
}

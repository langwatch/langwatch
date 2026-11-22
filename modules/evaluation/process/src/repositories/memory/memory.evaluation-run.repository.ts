import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import {
  EvaluationNotFoundError,
  type EvaluationOutcome,
  type EvaluationOutcomeCursor,
  type EvaluationRunData,
  type TraceEvaluationData,
} from "@langwatch/evaluation-contract";

import { DEFAULT_SCHEDULED_AT_SLACK_MS } from "../../rules/evaluation-run-lookup.rules.ts";
import {
  EvaluationRunRepository,
  type EvaluationInputsRead,
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
    const run = projectIdsReadBy(input.authorization)
      .map((projectId) => this.#runs.get(`${projectId}\u0000${input.evaluationId}`))
      .find((candidate) => candidate !== undefined);
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

  async findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    return projectIdsReadBy(input.authorization)
      .flatMap((projectId) => this.#tenantRuns(projectId))
      .filter((run) => run.traceId === input.traceId)
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  }

  async findTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<TraceEvaluationData[]> {
    return projectIdsReadBy(input.authorization)
      .flatMap((projectId) => this.#tenantRuns(projectId))
      .flatMap((run) =>
        run.traceId !== null && input.traceIds.includes(run.traceId)
          ? [
              {
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
              },
            ]
          : [],
      );
  }

  async findOutcomesSince(input: {
    authorization: Authorization;
    sinceMs: number;
    after: EvaluationOutcomeCursor | null;
    limit: number;
  }): Promise<EvaluationOutcome[]> {
    return projectIdsReadBy(input.authorization)
      .flatMap((projectId) => this.#tenantRuns(projectId))
      .flatMap(outcomeOf)
      .filter((outcome) => outcome.occurredAt >= input.sinceMs)
      .filter((outcome) => isAfter({ outcome, after: input.after }))
      .toSorted(byOccurredAtThenId)
      .slice(0, input.limit);
  }

  async findInputs(input: {
    authorization: Authorization;
    evaluationId: string;
  }): Promise<EvaluationInputsRead | null> {
    const tenantId = projectIdsReadBy(input.authorization)
      .toSorted()
      .find((projectId) => this.#runs.has(`${projectId}\u0000${input.evaluationId}`));
    if (tenantId === undefined) return null;
    return {
      tenantId,
      inputs: this.#runs.get(`${tenantId}\u0000${input.evaluationId}`)?.inputs ?? null,
    };
  }

  #tenantRuns(tenantId: string): EvaluationRunData[] {
    return [...this.#runs.entries()]
      .filter(([key]) => key.startsWith(`${tenantId}\u0000`))
      .map(([, run]) => run);
  }
}

/** A finished run on a trace as its outcome; the memory tier keeps no last event id. */
function outcomeOf(run: EvaluationRunData): EvaluationOutcome[] {
  if (!run.traceId) return [];
  const { status } = run;
  if (status !== "processed" && status !== "error" && status !== "skipped") return [];
  return [
    {
      evaluationId: run.evaluationId,
      traceId: run.traceId,
      evaluatorName: run.evaluatorName,
      isGuardrail: run.isGuardrail,
      status,
      passed: run.passed,
      label: run.label,
      occurredAt: run.LastEventOccurredAt,
      lastEventId: "",
    },
  ];
}

/** Whether an outcome sorts after the cursor, in (occurredAt, evaluationId) order. */
function isAfter({
  outcome,
  after,
}: {
  outcome: EvaluationOutcome;
  after: EvaluationOutcomeCursor | null;
}): boolean {
  if (after === null) return true;
  if (outcome.occurredAt !== after.occurredAt) return outcome.occurredAt > after.occurredAt;
  return outcome.evaluationId > after.evaluationId;
}

function byOccurredAtThenId(left: EvaluationOutcome, right: EvaluationOutcome): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt - right.occurredAt;
  if (left.evaluationId === right.evaluationId) return 0;
  return left.evaluationId < right.evaluationId ? -1 : 1;
}

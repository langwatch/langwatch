import type {
  EvaluationOutcome,
  EvaluationOutcomePage,
  EvaluationOutcomesQuery,
  EvaluationRunData,
  EvaluationRunLookup,
} from "@langwatch/evaluation-contract";

import type { TraceEvaluationRuns } from "../trace-evaluation-runs.channel.ts";

/** Evaluation's runs as a test scripts them, for a process that installs no evaluation. */
export class MemoryTraceEvaluationRunsChannel implements TraceEvaluationRuns {
  readonly runs = new Map<string, EvaluationRunData>();
  readonly outcomes: (EvaluationOutcome & { tenantId: string })[] = [];

  static create(): MemoryTraceEvaluationRunsChannel {
    return new MemoryTraceEvaluationRunsChannel();
  }

  private constructor() {}

  async findRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null> {
    return this.runs.get(`${input.tenantId}:${input.evaluationId}`) ?? null;
  }

  async listEvaluationOutcomes(input: EvaluationOutcomesQuery): Promise<EvaluationOutcomePage> {
    const page = this.outcomes
      .filter((outcome) => outcome.tenantId === input.tenantId)
      .filter((outcome) => outcome.occurredAt >= input.sinceMs)
      .filter((outcome) => isPast({ outcome, after: input.after }))
      .toSorted(byOccurredAtThenId)
      .slice(0, input.limit)
      .map(({ tenantId: _tenantId, ...outcome }) => outcome);
    const last = page.at(-1);
    return {
      outcomes: page,
      next:
        page.length === input.limit && last
          ? { occurredAt: last.occurredAt, evaluationId: last.evaluationId }
          : null,
    };
  }
}

/** Whether an outcome sorts after the cursor, in (occurredAt, evaluationId) order. */
function isPast({
  outcome,
  after,
}: {
  outcome: Pick<EvaluationOutcome, "occurredAt" | "evaluationId">;
  after: EvaluationOutcomesQuery["after"];
}): boolean {
  if (after === null) return true;
  if (outcome.occurredAt !== after.occurredAt) return outcome.occurredAt > after.occurredAt;
  return outcome.evaluationId > after.evaluationId;
}

function byOccurredAtThenId(
  left: Pick<EvaluationOutcome, "occurredAt" | "evaluationId">,
  right: Pick<EvaluationOutcome, "occurredAt" | "evaluationId">,
): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt - right.occurredAt;
  if (left.evaluationId === right.evaluationId) return 0;
  return left.evaluationId < right.evaluationId ? -1 : 1;
}

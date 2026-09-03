import {
  applyRunEvent,
  emptyRunResultsDraft,
  type RunResultsDraft,
} from "../run-results";
import type { EvaluationV3Event } from "../types";

/**
 * The event stream a backend run emits, replayed the way the executor replays
 * it, plus the two event builders every case needs. Shared by the fold suite
 * and the merge suite so both fold events exactly as production does.
 */

export const foldEvents = (events: EvaluationV3Event[]): RunResultsDraft => {
  const draft = emptyRunResultsDraft();
  for (const event of events) applyRunEvent({ draft, event });
  return draft;
};

export const targetResult = ({
  rowIndex,
  output,
}: {
  rowIndex: number;
  output: unknown;
}): EvaluationV3Event => ({
  type: "target_result",
  rowIndex,
  targetId: "target-1",
  output,
  cost: 0.01,
  duration: 120,
  traceId: `trace-${rowIndex}`,
} as never);

export const evaluatorResult = ({
  rowIndex,
  score,
}: {
  rowIndex: number;
  score: number;
}): EvaluationV3Event => ({
  type: "evaluator_result",
  rowIndex,
  targetId: "target-1",
  evaluatorId: "evaluator-1",
  result: { status: "processed", score } as never,
} as never);

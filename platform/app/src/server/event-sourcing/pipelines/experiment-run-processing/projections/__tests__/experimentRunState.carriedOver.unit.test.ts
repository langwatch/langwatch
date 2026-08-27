/**
 * @see specs/experiments-v3/run-board-snapshot.feature
 *
 * A run holds a snapshot of the whole board, so the cells outside its
 * execution scope are copied in rather than produced. A copied cell was paid
 * for by the run that produced it.
 *
 * The rule the fold enforces: money and time belong to this run, verdicts and
 * scores belong to the board. So a carried cell adds nothing to `TotalCost`,
 * `TotalDurationMs`, `CompletedCount`, `FailedCount` or `Progress` (the last
 * three are counted against `Total`, which is what the run dispatched), and it
 * does add to `PassedCount`, `GradedCount`, `TotalScoreSum` and `ScoreCount`.
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  EvaluatorResultEvent,
  ExperimentRunProcessingEvent,
  TargetResultEvent,
} from "../../schemas/events";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../experimentRunState.foldProjection";

const TENANT = createTenantId("project_test");

const envelope = (id: string) => ({
  id,
  aggregateId: "bold-jolly-bee",
  aggregateType: "experiment_run" as const,
  tenantId: TENANT,
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
});

const targetResult = ({
  id = "target",
  targetId = "target-A",
  index = 0,
  cost,
  duration,
  error,
  carriedOver,
}: {
  id?: string;
  targetId?: string;
  index?: number;
  cost?: number;
  duration?: number;
  error?: string;
  carriedOver?: boolean;
}): TargetResultEvent => ({
  ...envelope(id),
  type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
  data: {
    runId: "bold-jolly-bee",
    experimentId: "experiment_1",
    index,
    targetId,
    entry: { question: "q" },
    ...(cost !== undefined ? { cost } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(carriedOver !== undefined ? { carriedOver } : {}),
  },
});

const verdict = ({
  id = "verdict",
  targetId = "target-A",
  index = 0,
  score,
  passed,
  cost,
  carriedOver,
}: {
  id?: string;
  targetId?: string;
  index?: number;
  score?: number;
  passed?: boolean;
  cost?: number;
  carriedOver?: boolean;
}): EvaluatorResultEvent => ({
  ...envelope(id),
  type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
  data: {
    runId: "bold-jolly-bee",
    experimentId: "experiment_1",
    index,
    targetId,
    evaluatorId: "category_exact",
    evaluatorName: "category_exact",
    status: "processed",
    ...(score !== undefined ? { score } : {}),
    ...(passed !== undefined ? { passed } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(carriedOver !== undefined ? { carriedOver } : {}),
  },
});

/** The run's state after the fold has seen these events, in this order. */
const fold = (
  events: ExperimentRunProcessingEvent[],
): ExperimentRunStateData => {
  const projection = new ExperimentRunStateFoldProjection({
    store: {
      store: async () => undefined,
      get: async () => null,
    },
  });
  let state = projection.init();
  for (const event of events) {
    state = projection.apply(state, event);
  }
  return state;
};

describe("given a run that carried a cell in from the board", () => {
  describe("when the run's totals are folded", () => {
    /** @scenario "A carried-over output adds nothing to the run's cost" */
    it("leaves the carried output's money out of the total cost", () => {
      const state = fold([targetResult({ cost: 0.25, carriedOver: true })]);

      expect(state.TotalCost).toBeNull();
    });

    /** @scenario "A carried-over output adds nothing to the run's duration" */
    it("leaves the carried output's time out of the total duration", () => {
      const state = fold([targetResult({ duration: 4000, carriedOver: true })]);

      expect(state.TotalDurationMs).toBeNull();
    });

    /** @scenario "A carried-over output does not move the run's progress" */
    it("keeps the completed count and progress where they were", () => {
      // `Total` counts the cells the run dispatched. A carried cell that
      // incremented the completed count would report the run as more than
      // finished.
      const state = fold([targetResult({ carriedOver: true })]);

      expect(state.CompletedCount).toBe(0);
      expect(state.Progress).toBe(0);
    });

    /** @scenario "A carried-over failure does not move the run's failed count" */
    it("keeps the failed count where it was for a carried failure", () => {
      const state = fold([
        targetResult({ error: "lw.unnamed_failure", carriedOver: true }),
      ]);

      expect(state.FailedCount).toBe(0);
      expect(state.Progress).toBe(0);
    });

    /** @scenario "A carried-over verdict adds nothing to the run's cost" */
    it("leaves the carried verdict's money out of the total cost", () => {
      const state = fold([
        verdict({ passed: true, cost: 0.5, carriedOver: true }),
      ]);

      expect(state.TotalCost).toBeNull();
    });

    /** @scenario "A carried-over verdict counts toward the run's pass rate" */
    it("counts the carried verdict toward the pass rate", () => {
      const state = fold([
        verdict({ id: "carried", passed: true, carriedOver: true }),
        verdict({ id: "produced", targetId: "target-B", passed: false }),
      ]);

      expect(state.GradedCount).toBe(2);
      expect(state.PassedCount).toBe(1);
      expect(state.PassRateBps).toBe(5000);
    });

    /** @scenario "A carried-over verdict counts toward the run's average score" */
    it("counts the carried verdict toward the average score", () => {
      const state = fold([
        verdict({ score: 0.8, passed: true, carriedOver: true }),
      ]);

      expect(state.ScoreCount).toBe(1);
      expect(state.AvgScoreBps).toBe(8000);
    });
  });
});

describe("given a run that produced a cell itself", () => {
  describe("when the run's totals are folded", () => {
    /** @scenario "A cell the run produced still counts its own cost" */
    it("counts the output's money, its time and its progress", () => {
      const state = fold([targetResult({ cost: 0.25, duration: 4000 })]);

      expect(state.TotalCost).toBe(0.25);
      expect(state.TotalDurationMs).toBe(4000);
      expect(state.CompletedCount).toBe(1);
      expect(state.Progress).toBe(1);
    });
  });
});

describe("given a run that carried two columns and ran a third", () => {
  describe("when the run's totals are folded", () => {
    /**
     * Both halves of the rule in one case, so neither half can drift back on
     * its own: three columns' verdicts, one column's money.
     *
     * @scenario "A run that carries two columns and runs one splits money from verdicts"
     */
    it("scores all three columns and charges for only the one it ran", () => {
      const state = fold([
        targetResult({
          id: "carried-a",
          targetId: "target-A",
          cost: 1,
          duration: 1000,
          carriedOver: true,
        }),
        verdict({
          id: "verdict-a",
          targetId: "target-A",
          score: 1,
          passed: true,
          cost: 0.1,
          carriedOver: true,
        }),
        targetResult({
          id: "carried-b",
          targetId: "target-B",
          cost: 2,
          duration: 2000,
          carriedOver: true,
        }),
        verdict({
          id: "verdict-b",
          targetId: "target-B",
          score: 1,
          passed: true,
          cost: 0.2,
          carriedOver: true,
        }),
        targetResult({
          id: "ran-c",
          targetId: "target-C",
          cost: 3,
          duration: 3000,
        }),
        verdict({
          id: "verdict-c",
          targetId: "target-C",
          score: 0,
          passed: false,
          cost: 0.3,
        }),
      ]);

      // Verdicts and scores belong to the board: all three columns.
      expect(state.GradedCount).toBe(3);
      expect(state.PassedCount).toBe(2);
      expect(state.PassRateBps).toBe(6667);
      expect(state.ScoreCount).toBe(3);

      // Money and time belong to this run: only the column it ran.
      expect(state.TotalCost).toBeCloseTo(3.3, 10);
      expect(state.TotalDurationMs).toBe(3000);
      expect(state.CompletedCount).toBe(1);
      expect(state.Progress).toBe(1);
    });
  });
});

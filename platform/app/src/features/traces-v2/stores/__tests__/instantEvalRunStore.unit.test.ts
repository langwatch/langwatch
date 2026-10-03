import { beforeEach, describe, expect, it } from "vitest";
import type { InstantEvalExplorerRun } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import {
  selectInstantEvalRunPhase,
  useInstantEvalRunStore,
} from "../instantEvalRunStore";

const block: NonNullable<InstantEvalExplorerRun["processingBlock"]> = {
  code: "instant_eval_processing_disabled",
  observedAtMs: 10,
  stages: [{ componentType: "command", componentName: "recordPageJudged" }],
};
const run = (
  overrides: Partial<InstantEvalExplorerRun> = {},
): InstantEvalExplorerRun => ({
  id: "run-1",
  status: "running",
  total: 100,
  progress: 20,
  matched: 4,
  failed: 0,
  skipped: 0,
  error: null,
  priceUsd: 0.1,
  finishedAtMs: null,
  ...overrides,
});
const phase = () =>
  selectInstantEvalRunPhase(useInstantEvalRunStore.getState(), "run-1");
beforeEach(() =>
  useInstantEvalRunStore.setState({
    runs: {},
    quiet: {},
    settled: {},
    stoppedByUser: {},
    readUnavailable: {},
  }),
);

describe("InstantEvalRunStore", () => {
  describe("given equal running counters", () => {
    /** @scenario "Equal counters retain newly observed reporting interruption" */
    it("keeps the interruption and run identity", () => {
      useInstantEvalRunStore.getState().setRun(run());
      useInstantEvalRunStore.getState().setRun(run({ processingBlock: block }));
      expect({
        phase: phase(),
        run: useInstantEvalRunStore.getState().runs["run-1"],
      }).toMatchObject({
        phase: "interrupted",
        run: { id: "run-1", processingBlock: block },
      });
    });
  });
  describe("given observed interruption", () => {
    /** @scenario "Reporting interruption survives stale reads and settlement" */
    it("retains the warning through stale reads and a late settlement callback", () => {
      const store = useInstantEvalRunStore.getState();
      store.setRun(run({ status: "finished", finishedAtMs: 1 }));
      store.markSettled("run-1");
      store.setRun(
        run({ status: "finished", finishedAtMs: 1, processingBlock: block }),
      );
      store.setRun(run({ status: "finished", finishedAtMs: 1, progress: 100 }));
      store.markSettled("run-1");
      expect({
        phase: phase(),
        settled: useInstantEvalRunStore.getState().settled["run-1"],
        quiet: useInstantEvalRunStore.getState().quiet["run-1"],
      }).toEqual({
        phase: "interrupted",
        settled: undefined,
        quiet: undefined,
      });
    });
    /** @scenario "Reporting interruption survives stale reads and settlement" */
    it("keeps the warning when an old terminal run is first loaded", () => {
      useInstantEvalRunStore
        .getState()
        .setRun(
          run({ status: "finished", finishedAtMs: 1, processingBlock: block }),
          100_000,
        );
      expect(phase()).toBe("interrupted");
    });
  });
});

/**
 * @see specs/experiments-v3/workbench-versioning.feature
 *
 * The writer a streaming run feeds its frames into. The route decides whether
 * a run writes its cells at all; this decides what one frame stream turns into.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentService } from "~/server/experiments/experiment.service";
import { createRunResultsWriter } from "../runResultsWriter";
import type { EvaluationV3Event } from "../types";

const applyWorkbenchTransform = vi.fn();

const writerFor = () =>
  createRunResultsWriter({
    persistence: {
      experiments: { applyWorkbenchTransform } as unknown as ExperimentService,
      actor: { userId: "user_1", label: "user" },
    },
    projectId: "project_1",
    experimentId: "experiment_1",
    scope: { type: "full" },
  });

const feed = async (events: EvaluationV3Event[]) => {
  const writer = writerFor();
  for (const event of events) await writer.record(event);
  return writer;
};

const started = {
  type: "execution_started",
  runId: "swift-bold-fox",
  total: 1,
} as unknown as EvaluationV3Event;

const anOutput = {
  type: "target_result",
  rowIndex: 0,
  targetId: "target-1",
  output: "an answer",
} as unknown as EvaluationV3Event;

const done = {
  type: "done",
  summary: { total: 1, completed: 1 },
} as unknown as EvaluationV3Event;

beforeEach(() => {
  applyWorkbenchTransform.mockReset();
  applyWorkbenchTransform.mockResolvedValue({ version: 4 });
});

describe("createRunResultsWriter", () => {
  describe("when the run ends before it names itself", () => {
    /** @scenario "A run that ends before it names itself writes nothing" */
    it("writes nothing into the saved state", async () => {
      await feed([anOutput, done]);

      expect(applyWorkbenchTransform).not.toHaveBeenCalled();
    });
  });

  describe("when the run has not ended yet", () => {
    /** @scenario "A run started from the open page writes its cells too" */
    it("holds the cells rather than writing each frame", async () => {
      await feed([started, anOutput]);

      expect(applyWorkbenchTransform).not.toHaveBeenCalled();
    });
  });

  describe("when the run produced no cells", () => {
    /** @scenario "A run started from the open page writes its cells too" */
    it("writes nothing into the saved state", async () => {
      await feed([started, done]);

      expect(applyWorkbenchTransform).not.toHaveBeenCalled();
    });
  });

  describe("when the run reports it ended twice", () => {
    /** @scenario "A run started from the open page writes its cells too" */
    it("writes once, so the cells take one version and not two", async () => {
      await feed([started, anOutput, done, done]);

      expect(applyWorkbenchTransform).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the write fails", () => {
    /** @scenario "A failure to write the cells back does not fail the run" */
    it("swallows the failure, because the stream must reach the page", async () => {
      applyWorkbenchTransform.mockRejectedValue(new Error("postgres is down"));

      await expect(feed([started, anOutput, done])).resolves.toBeDefined();
    });
  });
});

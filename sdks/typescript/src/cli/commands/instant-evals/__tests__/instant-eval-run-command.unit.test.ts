/**
 * `instant-eval run`, against a mocked service.
 *
 * What this pins is the estimate that has to happen before a large spend, the
 * estimate that must NOT happen for a small one, what a blocking run leaves
 * on the screen, and the exit code a failed run sets.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  ESTIMATE,
  FINISHED_RUN,
  ProcessExitError,
  RUN,
  installCommandHarness,
  serviceSpies,
} from "./instant-eval-command-fixtures";

vi.mock("../cli-instant-evals-service", () => ({
  createCliInstantEvalsService: vi.fn(() => serviceSpies),
}));

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
    text: "",
  }),
}));

import { runInstantEvalCommand } from "../run";

const {
  create: createSpy,
  estimate: estimateSpy,
  get: getSpy,
  sample: sampleSpy,
} = serviceSpies;
const { printed } = installCommandHarness();

describe("instant-eval run, given a question", () => {
  describe("when --estimate is asked for", () => {
    /** @scenario "--estimate prices the run and creates nothing" */
    it("prices the run and creates nothing", async () => {
      estimateSpy.mockResolvedValue(ESTIMATE);

      await runInstantEvalCommand(
        "the customer sounds annoyed",
        { target: "threads", estimate: true },
        [],
      );

      expect(estimateSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
      expect(printed()).toContain("5,000");
    });
  });

  describe("when the run is large", () => {
    /** @scenario "A run over a thousand rows prints the estimate before it creates" */
    it("prices it first, then creates it", async () => {
      estimateSpy.mockResolvedValue(ESTIMATE);
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand(
        "the customer sounds annoyed",
        { limit: "10000" },
        [],
      );

      expect(estimateSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(estimateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        createSpy.mock.invocationCallOrder[0]!,
      );
    });

    it("creates the run anyway when pricing it fails", async () => {
      estimateSpy.mockRejectedValue(new Error("down"));
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand("annoyed", { limit: "10000" }, []);

      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A machine format keeps the estimate out of the document" */
    it("keeps the estimate out of a machine document", async () => {
      estimateSpy.mockResolvedValue(ESTIMATE);
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand(
        "annoyed",
        { limit: "10000", output: "json" },
        [],
      );

      const document = JSON.parse(printed());
      expect(document.outcome).toBe("finished");
      expect(document.run.id).toBe(RUN.id);
    });
  });

  describe("when the run is small", () => {
    /** @scenario "A small run is created without a separate estimate call" */
    it("creates it without a second round trip", async () => {
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand("annoyed", { limit: "200" }, []);

      expect(estimateSpy).not.toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the run was created", () => {
    /** @scenario "run prints the statement under a heading in table mode" */
    it("prints the statement under its own heading", async () => {
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand("annoyed", {}, []);

      const output = printed();
      expect(output).toContain("Statement:");
      expect(output).toContain("FROM analytics.traces");
      expect(output).toContain("start_at");
    });
  });

  describe("when the run finishes", () => {
    /** @scenario "run waits for the run and prints what it found" */
    it("prints the headline with the matches, the time and the price", async () => {
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand("annoyed", {}, []);

      const output = printed();
      expect(output).toContain("Found");
      expect(output).toContain("412");
      expect(output).toContain("$0.33");
      expect(output).toContain("instant-eval results");
    });

    /** @scenario "run reads back the first rows of a finished run" */
    it("reads the rows back through the sample, judging nothing again", async () => {
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand("annoyed", {}, []);

      expect(sampleSpy).toHaveBeenCalledWith(FINISHED_RUN.id, { n: 20 });
    });

    /** @scenario "--show changes how many rows the run prints" */
    it("asks for the number of rows --show named", async () => {
      createSpy.mockResolvedValue(FINISHED_RUN);

      await runInstantEvalCommand("annoyed", { show: "5" }, []);

      expect(sampleSpy).toHaveBeenCalledWith(FINISHED_RUN.id, { n: 5 });
    });

    /** @scenario "A machine format answers with one document carrying the run and its rows" */
    it("carries the run and its judgements in one document", async () => {
      createSpy.mockResolvedValue(FINISHED_RUN);
      sampleSpy.mockResolvedValue({
        rows: [{ TraceId: "abc", q1: "the customer is upset" }],
        judgments: [
          {
            traceId: "abc",
            questionId: "q1",
            status: "judged",
            passed: true,
            probability: 0.82,
            score: null,
            label: null,
          },
        ],
      });

      await runInstantEvalCommand("annoyed", { output: "json" }, []);

      const document = JSON.parse(printed());
      expect(document.outcome).toBe("finished");
      expect(document.judgments).toHaveLength(1);
    });
  });

  describe("when the run is detached", () => {
    /** @scenario "--detach creates the run and returns its id" */
    it("returns the id without waiting for the run", async () => {
      createSpy.mockResolvedValue(RUN);

      await runInstantEvalCommand("annoyed", { detach: true }, []);

      expect(getSpy).not.toHaveBeenCalled();
      expect(sampleSpy).not.toHaveBeenCalled();
      expect(printed()).toContain("instant-eval status");
    });
  });

  describe("when a run ends in a state that is not finished", () => {
    /** @scenario "A run that failed exits non-zero" */
    it("exits non-zero", async () => {
      createSpy.mockResolvedValue({ ...FINISHED_RUN, status: "failed" });

      await runInstantEvalCommand("annoyed", {}, []);

      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the platform refuses the run", () => {
    /** @scenario "A refusal from the platform exits non-zero" */
    it("exits non-zero", async () => {
      createSpy.mockRejectedValue(new Error("instant_eval_row_cap_exceeded"));

      await expect(
        runInstantEvalCommand("annoyed", { limit: "50000" }, []),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

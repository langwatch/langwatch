/**
 * The `instant-eval` read subcommands (`estimate`, `status`, `list`, `results`, `sample`) against a
 * mocked service: the request each makes and the one document it answers.
 * @see specs/features/instant-eval-cli.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  ESTIMATE,
  JUDGMENT,
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

import { estimateInstantEvalCommand } from "../estimate";
import { listInstantEvalsCommand } from "../list";
import { resultsInstantEvalCommand } from "../results";
import { sampleInstantEvalCommand } from "../sample";
import { statusInstantEvalCommand } from "../status";

const {
  estimate: estimateSpy,
  get: getSpy,
  list: listSpy,
  results: resultsSpy,
  sample: sampleSpy,
} = serviceSpies;
const { printed } = installCommandHarness();

describe("instant-eval estimate, given the same inputs a run takes", () => {
  describe("when it is priced", () => {
    /** @scenario "estimate is also its own subcommand, with the same inputs as run" */
    it("sends the body a run would have sent", async () => {
      estimateSpy.mockResolvedValue(ESTIMATE);

      const result = await estimateInstantEvalCommand(
        "annoyed",
        { target: "threads", last: "30d" },
        [],
      );

      expect(estimateSpy).toHaveBeenCalledWith(expect.objectContaining({ target: "threads" }));
      expect(result?.data).toEqual(ESTIMATE);
    });
  });

  describe("when the organization has a free budget", () => {
    /** @scenario "estimate prints what is left of the free budget" */
    it("prints what is left of it", async () => {
      estimateSpy.mockResolvedValue({
        ...ESTIMATE,
        freeBudgetRemainingUsd: 0.6,
      });

      const result = await estimateInstantEvalCommand(
        "annoyed",
        { target: "threads", last: "30d" },
        [],
      );
      result?.table?.();

      expect(printed()).toContain("Free budget: $0.60 left");
    });
  });

  describe("when the organization is on a paid plan", () => {
    /** @scenario "estimate prints no free budget line for a paid organization" */
    it("prints no free budget line", async () => {
      estimateSpy.mockResolvedValue(ESTIMATE);

      const result = await estimateInstantEvalCommand(
        "annoyed",
        { target: "threads", last: "30d" },
        [],
      );
      result?.table?.();

      expect(printed()).not.toContain("Free budget");
    });
  });
});

describe("instant-eval status, given a run id", () => {
  describe("when the run is read", () => {
    /** @scenario "status reads one run" */
    it("prints where it is", async () => {
      getSpy.mockResolvedValue({ ...RUN, status: "running", progress: 120 });

      await statusInstantEvalCommand("instant_eval_abc", {});

      expect(getSpy).toHaveBeenCalledWith("instant_eval_abc");
      expect(printed()).toContain("running");
    });
  });
});

describe("instant-eval list, given the project's runs", () => {
  describe("when they are listed", () => {
    /** @scenario "list reads the project's runs, newest first" */
    it("answers with them", async () => {
      listSpy.mockResolvedValue([RUN]);

      const result = await listInstantEvalsCommand({ limit: "5" });

      expect(listSpy).toHaveBeenCalledWith({ limit: 5 });
      expect(result?.data).toEqual([RUN]);
    });

    it("points at how to start one when there are none", async () => {
      listSpy.mockResolvedValue([]);

      const result = await listInstantEvalsCommand({});
      result?.table();

      expect(printed()).toContain("langwatch instant-eval run");
    });
  });
});

describe("instant-eval results, given a run", () => {
  describe("when a page is read", () => {
    /** @scenario "results reads one page of judgements" */
    it("answers with the judgements and the next cursor", async () => {
      resultsSpy.mockResolvedValue({
        judgments: [JUDGMENT],
        nextCursor: "cursor_2",
      });

      const result = await resultsInstantEvalCommand("instant_eval_abc", {});
      result?.table();

      expect(printed()).toContain("cursor_2");
    });
  });

  describe("when the page is narrowed", () => {
    /** @scenario "results narrows by question, by match and by state" */
    it("forwards the question, the match and the state", async () => {
      resultsSpy.mockResolvedValue({ judgments: [] });

      await resultsInstantEvalCommand("instant_eval_abc", {
        question: "q1",
        matched: true,
        status: "judged",
        limit: "50",
      });

      expect(resultsSpy).toHaveBeenCalledWith("instant_eval_abc", {
        questionId: "q1",
        isMatched: true,
        status: "judged",
        limit: 50,
      });
    });

    it("reads --unmatched as the other half", async () => {
      resultsSpy.mockResolvedValue({ judgments: [] });

      await resultsInstantEvalCommand("instant_eval_abc", { unmatched: true });

      expect(resultsSpy).toHaveBeenCalledWith("instant_eval_abc", {
        isMatched: false,
      });
    });

    it("refuses both halves at once", async () => {
      await expect(
        resultsInstantEvalCommand("instant_eval_abc", {
          matched: true,
          unmatched: true,
        }),
      ).rejects.toThrow(ProcessExitError);
      expect(resultsSpy).not.toHaveBeenCalled();
    });

    it("refuses a state that is not one a judgement can be in", async () => {
      await expect(
        resultsInstantEvalCommand("instant_eval_abc", { status: "pending" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("instant-eval sample, given a run", () => {
  describe("when a few rows are read", () => {
    /** @scenario "sample reads a few rows with the text that was judged" */
    it("asks for that many and prints the text beside the verdict", async () => {
      sampleSpy.mockResolvedValue({
        rows: [{ TraceId: "trace_1", q1: "User: where is my order" }],
        judgments: [JUDGMENT],
      });

      const result = await sampleInstantEvalCommand("instant_eval_abc", {
        number: "5",
      });
      result?.table();

      expect(sampleSpy).toHaveBeenCalledWith("instant_eval_abc", { n: 5 });
      expect(printed()).toContain("where is my order");
      expect(printed()).toContain("yes (0.82)");
    });
  });
});

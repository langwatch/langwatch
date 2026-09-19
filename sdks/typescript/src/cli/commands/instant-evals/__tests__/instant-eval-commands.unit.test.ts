/**
 * The `instant-eval` subcommands, against a mocked service.
 *
 * What these pin is the request each one makes and the one document it
 * answers with: the estimate that has to happen before a large spend, the
 * estimate that must NOT happen for a small one, the filters `results`
 * forwards, and the exit code a failed run sets.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const createSpy = vi.hoisted(() => vi.fn());
const estimateSpy = vi.hoisted(() => vi.fn());
const getSpy = vi.hoisted(() => vi.fn());
const listSpy = vi.hoisted(() => vi.fn());
const resultsSpy = vi.hoisted(() => vi.fn());
const sampleSpy = vi.hoisted(() => vi.fn());
const cancelSpy = vi.hoisted(() => vi.fn());

vi.mock("../cli-instant-evals-service", () => ({
  createCliInstantEvalsService: vi.fn(() => ({
    create: createSpy,
    estimate: estimateSpy,
    get: getSpy,
    list: listSpy,
    results: resultsSpy,
    sample: sampleSpy,
    cancel: cancelSpy,
  })),
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

import { cancelInstantEvalCommand } from "../cancel";
import { estimateInstantEvalCommand } from "../estimate";
import { listInstantEvalsCommand } from "../list";
import { resultsInstantEvalCommand } from "../results";
import { runInstantEvalCommand } from "../run";
import { sampleInstantEvalCommand } from "../sample";
import { statusInstantEvalCommand } from "../status";

class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const RUN = {
  id: "instant_eval_abc",
  name: null,
  sql: "SELECT\n  TraceId,\n  eval(llm_readable_trace(TraceId, 8000), 'annoyed') AS q1\nFROM analytics.traces",
  parameters: { start_at: "2026-09-11 12:00:00" },
  questions: [
    {
      id: "q1",
      function: "eval",
      kind: "boolean" as const,
      reads: "probability",
      threshold: 0.5,
    },
  ],
  limit: 1_000,
  status: "queued" as const,
  total: null,
  progress: 0,
  matched: null,
  matchedByQuestion: {},
  failed: 0,
  skipped: 0,
  tokens: 0,
  costUsd: 0,
  priceUsd: 0,
  error: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
};

/** The same run once it is over, which is what a blocking run answers with. */
const FINISHED_RUN = {
  ...RUN,
  status: "finished" as const,
  total: 10_000,
  progress: 10_000,
  matched: 412,
  matchedByQuestion: { q1: 412 },
  tokens: 6_100_000,
  costUsd: 0.2562,
  priceUsd: 0.33,
  startedAt: "2026-09-18T12:00:01.000Z",
  finishedAt: "2026-09-18T12:00:21.000Z",
};

const ESTIMATE = {
  rows: 5_000,
  isRowsCapped: false,
  avgTokens: 900,
  totalTokens: 4_500_000,
  requests: 5_000,
  costUsd: 0.189,
  priceUsd: 0.2457,
};

const JUDGMENT = {
  traceId: "trace_1",
  questionId: "q1",
  threadId: "thread_1",
  spanId: "",
  kind: "boolean",
  status: "judged" as const,
  passed: true,
  score: null,
  label: null,
  probability: 0.82,
  probabilities: null,
  error: null,
  occurredAt: "2026-09-18T12:00:00.000Z",
};

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let savedAgentMode: [string, string | undefined][];

beforeEach(() => {
  vi.clearAllMocks();
  // Agent mode is detected from the environment, and this suite runs inside a
  // coding agent, so the table renderings would never be reached.
  savedAgentMode = AGENT_MODE_ENV_VARS.map((name) => [
    name,
    process.env[name],
  ]);
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  process.exitCode = undefined;
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  sampleSpy.mockResolvedValue({ rows: [], judgments: [] });
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  for (const [name, value] of savedAgentMode) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  process.exitCode = undefined;
});

const printed = (): string =>
  logSpy.mock.calls
    .map((call: unknown[]) => call.map(String).join(" "))
    .join("\n");

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
      expect(
        estimateSpy.mock.invocationCallOrder[0]!,
      ).toBeLessThan(createSpy.mock.invocationCallOrder[0]!);
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

      expect(estimateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ target: "threads" }),
      );
      expect(result?.data).toEqual(ESTIMATE);
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

describe("instant-eval cancel, given a running run", () => {
  describe("when it is cancelled", () => {
    /** @scenario "cancel asks a run to stop" */
    it("asks the platform to stop it", async () => {
      cancelSpy.mockResolvedValue({ ...RUN, status: "cancelled" });

      const result = await cancelInstantEvalCommand("instant_eval_abc");

      expect(cancelSpy).toHaveBeenCalledWith("instant_eval_abc");
      expect((result?.data as { status: string }).status).toBe("cancelled");
    });

    it("exits non-zero when the run already finished", async () => {
      cancelSpy.mockRejectedValue(new Error("instant_eval_already_finished"));

      await expect(
        cancelInstantEvalCommand("instant_eval_abc"),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

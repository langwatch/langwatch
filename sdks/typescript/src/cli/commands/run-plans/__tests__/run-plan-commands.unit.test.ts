/**
 * The `run-plan` commands.
 *
 * A run plan is identified by its NAME, so what these assertions pin is the
 * request: one POST carrying the scope, the targets and the configuration, and
 * a refusal before anything is scheduled whenever the command line says two
 * things at once.
 *
 * Spec: specs/features/run-plan-cli.feature
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunPlansApiError } from "@/client-sdk/services/run-plans";
import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const runSpy = vi.hoisted(() => vi.fn());
const listSpy = vi.hoisted(() => vi.fn());
const getSpy = vi.hoisted(() => vi.fn());
const archiveSpy = vi.hoisted(() => vi.fn());
const listSuitesSpy = vi.hoisted(() => vi.fn());

vi.mock("../cli-run-plans-service", () => ({
  createCliRunPlansService: vi.fn(() => ({
    run: runSpy,
    list: listSpy,
    get: getSpy,
    archive: archiveSpy,
    rerun: vi.fn(),
  })),
}));

vi.mock("../../test-suites/cli-test-suites-service", () => ({
  createCliTestSuitesService: vi.fn(() => ({ list: listSuitesSpy })),
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
    text: "",
  }),
}));

import { runRunPlanCommand } from "../run";
import { listRunPlansCommand } from "../list";
import { getRunPlanCommand } from "../get";
import { archiveRunPlanCommand } from "../archive";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const makeRunResult = (overrides: Record<string, unknown> = {}) => ({
  scheduled: true,
  batchRunId: "batch_123",
  setId: "set_456",
  jobCount: 2,
  skippedArchived: { scenarios: [], targets: [] },
  items: [],
  runPlanId: "plan_abc",
  planName: "All scenarios against Support Agent",
  created: true,
  platformUrl: "https://app.langwatch.ai/proj-1/agent-testing/results",
  ...overrides,
});

const makePlan = (overrides: Record<string, unknown> = {}) => ({
  id: "plan_abc",
  name: "Nightly regression",
  slug: "nightly-regression",
  scope: { mode: "all" as const },
  scenarioIds: [],
  targets: [{ type: "http" as const, referenceId: "agent_abc" }],
  repeatCount: 1,
  simulatorModel: null,
  judgeModel: null,
  labels: [],
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/proj-1/agent-testing/results",
  ...overrides,
});

/**
 * The command resolves its output format from the flags AND the agent-mode env
 * vars, so a test runner living inside a coding agent (CLAUDECODE set) must not
 * flip the human-path tests into a machine format.
 */
let savedAgentEnv: Record<string, string | undefined> = {};

/** Every JSON document the command printed on stdout. */
const printedDocuments = (): string[] =>
  vi
    .mocked(console.log)
    .mock.calls.map((call) => call[0] as unknown)
    .filter(
      (line): line is string =>
        typeof line === "string" && line.trimStart().startsWith("{"),
    );

beforeEach(() => {
  vi.clearAllMocks();
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  runSpy.mockResolvedValue(makeRunResult());
  listSpy.mockResolvedValue([]);
  getSpy.mockResolvedValue(makePlan());
  archiveSpy.mockResolvedValue({ id: "plan_abc", archived: true });
  listSuitesSpy.mockResolvedValue([]);
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  for (const name of AGENT_MODE_ENV_VARS) {
    const value = savedAgentEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  // The wait paths set the exit code; a leftover value would fail the whole
  // vitest process at the end of the run.
  process.exitCode = undefined;
});

/**
 * A fresh response per call. A `Response` body can be read once, so handing the
 * same object to every poll turns the second read into a poll FAILURE.
 */
const answersWith = (runs: unknown[]) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ runs, hasMore: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

/** Drives the poll without waiting out its real three-second interval. */
const runWithFakeTimers = async ({
  advanceMs,
  format = "json",
}: {
  advanceMs: number;
  /** The commander default is "table", which is the human path. */
  format?: string;
}): Promise<void> => {
  vi.useFakeTimers();
  try {
    const promise = runRunPlanCommand({
      all: true,
      target: ["http:agent_abc"],
      wait: true,
      format,
    });
    await vi.advanceTimersByTimeAsync(advanceMs);
    await promise;
  } finally {
    vi.useRealTimers();
  }
};

describe("runRunPlanCommand()", () => {
  describe("when the scope covers every scenario", () => {
    /** @scenario "Run every active scenario against a target" */
    it("posts one run carrying a scope of all scenarios", async () => {
      await runRunPlanCommand({ all: true, target: ["http:agent_abc"] });

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith({
        config: {
          scope: { mode: "all" },
          targets: [{ type: "http", referenceId: "agent_abc" }],
        },
      });
    });

    /** @scenario "Run every active scenario against a target" */
    it("reports the plan name, the job count and the batch run ID", async () => {
      await runRunPlanCommand({ all: true, target: ["http:agent_abc"] });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("All scenarios against Support Agent");
      expect(printed).toContain("batch_123");
      expect(printed).toContain("2");
    });
  });

  describe("when the scope names a test suite", () => {
    /** @scenario "Run the scenarios filed in a test suite" */
    it("resolves the name to its ID", async () => {
      listSuitesSpy.mockResolvedValue([
        { id: "suite_1", name: "Refunds", slug: "refunds", scenarioIds: [], scenarioCount: 0 },
      ]);

      await runRunPlanCommand({ testSuite: ["Refunds"], target: ["http:agent_abc"] });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            scope: { mode: "test_suites", testSuiteIds: ["suite_1"] },
          }),
        }),
      );
    });

    /** @scenario "Run a test suite name that names nothing" */
    it("refuses a name that matches no test suite, scheduling nothing", async () => {
      listSuitesSpy.mockResolvedValue([]);

      await expect(
        runRunPlanCommand({ testSuite: ["Refunds"], target: ["http:agent_abc"] }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the scope names labels", () => {
    /** @scenario "Run the scenarios carrying a label" */
    it("carries every repeated label", async () => {
      await runRunPlanCommand({
        label: ["checkout", "refunds"],
        target: ["http:agent_abc"],
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            scope: { mode: "labels", labels: ["checkout", "refunds"] },
          }),
        }),
      );
    });
  });

  describe("when the scope names scenarios", () => {
    /** @scenario "Run named scenarios" */
    it("sends a scenarios scope and the scenario IDs", async () => {
      await runRunPlanCommand({
        scenario: ["scenario_1", "scenario_2"],
        target: ["http:agent_abc"],
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            scope: { mode: "scenarios" },
            scenarioIds: ["scenario_1", "scenario_2"],
          }),
        }),
      );
    });
  });

  describe("when more than one target is named", () => {
    /** @scenario "Run against more than one target" */
    it("sends both", async () => {
      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc", "prompt:prompt_xyz"],
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            targets: [
              { type: "http", referenceId: "agent_abc" },
              { type: "prompt", referenceId: "prompt_xyz" },
            ],
          }),
        }),
      );
    });
  });

  describe("when a name is given", () => {
    /** @scenario "Run under a name that names an existing plan" */
    it("sends the name, which is the plan's identity", async () => {
      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        name: "Nightly regression",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Nightly regression" }),
      );
    });
  });

  describe("when no name is given", () => {
    /** @scenario "Run without a name" */
    it("sends no name, leaving the platform to derive one", async () => {
      await runRunPlanCommand({ all: true, target: ["http:agent_abc"] });

      expect(runSpy.mock.calls[0]![0]).not.toHaveProperty("name");
    });
  });

  describe("when a repeat count and models are given", () => {
    /** @scenario "Run with a repeat count and models" */
    it("carries all three in the configuration", async () => {
      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        repeat: "3",
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            repeatCount: 3,
            simulatorModel: "openai/gpt-5-mini",
            judgeModel: "openai/gpt-5-mini",
          }),
        }),
      );
    });

    it("refuses a repeat count outside one to five", async () => {
      await expect(
        runRunPlanCommand({ all: true, target: ["http:agent_abc"], repeat: "9" }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when --param pairs are given", () => {
    /** @scenario "Run with parameters" */
    it("hands the run the values those names resolve to", async () => {
      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        param: ["account_tier=gold", "seats=12", "beta=false"],
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: { account_tier: "gold", seats: 12, beta: false },
        }),
      );
    });
  });

  describe("when a note is given", () => {
    /** @scenario "Run with a note" */
    it("sends it with the run", async () => {
      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        note: "after the timeout fix",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ note: "after the timeout fix" }),
      );
    });

    /** @scenario "Run with a note over two hundred characters" */
    it("refuses a note over the limit before anything is scheduled", async () => {
      await expect(
        runRunPlanCommand({
          all: true,
          target: ["http:agent_abc"],
          note: "x".repeat(201),
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when an idempotency key is given", () => {
    /** @scenario "Run with an idempotency key" */
    it("sends it with the request", async () => {
      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        idempotencyKey: "nightly-2026-08-28",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "nightly-2026-08-28" }),
      );
    });
  });

  describe("when two scope flags are given", () => {
    /** @scenario "Run with two scope flags" */
    it("refuses the command instead of merging them", async () => {
      await expect(
        runRunPlanCommand({
          all: true,
          label: ["checkout"],
          target: ["http:agent_abc"],
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when no scope flag is given", () => {
    /** @scenario "Run with no scope flag" */
    it("refuses rather than running the whole project by accident", async () => {
      await expect(
        runRunPlanCommand({ target: ["http:agent_abc"] }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when no target is given", () => {
    /** @scenario "Run with no target" */
    it("refuses, because a run has nothing to go against", async () => {
      await expect(runRunPlanCommand({ all: true })).rejects.toThrow(
        ProcessExitError,
      );

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a target is malformed", () => {
    /** @scenario "Run with a malformed target" */
    it("refuses and names the shape it wanted", async () => {
      await expect(
        runRunPlanCommand({ all: true, target: ["agent_abc"] }),
      ).rejects.toThrow(ProcessExitError);

      const reported = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(reported).toContain("<type>:<referenceId>");
    });
  });

  describe("when a machine format is requested", () => {
    /** @scenario "Run with machine-readable output" */
    it("prints one document carrying the schedule payload and a scheduled outcome", async () => {
      const result = makeRunResult();
      runSpy.mockResolvedValue(result);

      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        format: "json",
      });

      expect(printedDocuments()).toEqual([
        JSON.stringify({ ...result, outcome: "scheduled" }, null, 2),
      ]);
    });
  });

  describe("when --wait ends under a machine format", () => {
    /** @scenario "Wait with machine-readable output" */
    it("prints exactly one final document with the tallies, the per-run results and the outcome", async () => {
      runSpy.mockResolvedValue(makeRunResult({ jobCount: 2 }));
      answersWith([
        {
          batchRunId: "batch_123",
          scenarioRunId: "run_1",
          scenarioId: "scenario_1",
          status: "SUCCESS",
          results: { verdict: "success" },
        },
        {
          batchRunId: "batch_123",
          scenarioRunId: "run_2",
          scenarioId: "scenario_2",
          status: "ERROR",
          results: null,
        },
      ]);

      await runWithFakeTimers({ advanceMs: 3000 });

      const documents = printedDocuments();
      expect(documents).toHaveLength(1);
      const document = JSON.parse(documents[0]!) as Record<string, unknown>;
      expect(document.batchRunId).toBe("batch_123");
      expect(document.outcome).toBe("failed");
      expect(document.tallies).toEqual({
        total: 2,
        completed: 2,
        passed: 1,
        failed: 1,
      });
      expect(document.results).toEqual([
        {
          scenarioRunId: "run_1",
          scenarioId: "scenario_1",
          status: "SUCCESS",
          verdict: "success",
        },
        {
          scenarioRunId: "run_2",
          scenarioId: "scenario_2",
          status: "ERROR",
          verdict: null,
        },
      ]);
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the wait times out under a machine format", () => {
    /** @scenario "A timed-out wait still emits the machine-readable document" */
    it("still prints the final document, naming the timeout outcome", async () => {
      runSpy.mockResolvedValue(makeRunResult({ jobCount: 1 }));
      answersWith([{ batchRunId: "batch_123", status: "IN_PROGRESS" }]);

      await runWithFakeTimers({ advanceMs: 10 * 60 * 1000 + 3000 });

      const documents = printedDocuments();
      expect(documents).toHaveLength(1);
      const document = JSON.parse(documents[0]!) as Record<string, unknown>;
      expect(document.outcome).toBe("timeout");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when the status endpoint keeps failing under a machine format", () => {
    /** @scenario "A dead status endpoint still emits the machine-readable document" */
    it("still prints the final document, naming the poll failure outcome", async () => {
      runSpy.mockResolvedValue(makeRunResult({ jobCount: 1 }));
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("endpoint down"),
      );

      await runWithFakeTimers({ advanceMs: 5 * 3000 });

      const documents = printedDocuments();
      expect(documents).toHaveLength(1);
      const document = JSON.parse(documents[0]!) as Record<string, unknown>;
      expect(document.outcome).toBe("poll_failure");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("when --wait completes in human mode", () => {
    /** @scenario "Waiting in human mode prints no machine document" */
    it("prints the human tail and no JSON document", async () => {
      runSpy.mockResolvedValue(makeRunResult({ jobCount: 1 }));
      answersWith([
        {
          batchRunId: "batch_123",
          scenarioRunId: "run_1",
          scenarioId: "scenario_1",
          status: "SUCCESS",
          results: { verdict: "success" },
        },
      ]);

      await runWithFakeTimers({ advanceMs: 3000, format: "table" });

      expect(printedDocuments()).toHaveLength(0);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("batch_123"),
      );
      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("when the run scheduled no job and --wait was passed", () => {
    /** @scenario "Wait for a run that scheduled no job" */
    it("returns without polling instead of waiting out the timeout", async () => {
      runSpy.mockResolvedValue(
        makeRunResult({
          jobCount: 0,
          skippedArchived: { scenarios: ["archived_scenario"], targets: [] },
        }),
      );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}", { status: 200 }));

      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        wait: true,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when --wait is passed", () => {
    /** @scenario "Wait for a run to complete" */
    it("polls until every run has stopped and reports the counts", async () => {
      runSpy.mockResolvedValue(makeRunResult({ jobCount: 1 }));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            runs: [
              {
                batchRunId: "batch_123",
                status: "SUCCESS",
                results: { verdict: "success" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        wait: true,
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("when --wait is passed and a run of the batch failed", () => {
    /** @scenario "Wait for a run that failed" */
    it("exits with code 1", async () => {
      const previousExitCode = process.exitCode;
      runSpy.mockResolvedValue(makeRunResult({ jobCount: 1 }));
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            runs: [
              {
                batchRunId: "batch_123",
                status: "FAILED",
                results: { verdict: "failure" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      await runRunPlanCommand({
        all: true,
        target: ["http:agent_abc"],
        wait: true,
      });

      expect(process.exitCode).toBe(1);
      process.exitCode = previousExitCode;
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      runSpy.mockRejectedValue(
        new RunPlansApiError("Not found", "run a run plan"),
      );

      await expect(
        runRunPlanCommand({ all: true, target: ["http:agent_abc"] }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("listRunPlansCommand()", () => {
  describe("when run plans exist", () => {
    /** @scenario "List run plans" */
    it("returns the listing as the payload instead of printing it", async () => {
      const plans = [makePlan()];
      listSpy.mockResolvedValue(plans);

      const result = await listRunPlansCommand({});

      expect(listSpy).toHaveBeenCalledWith({ includeArchived: undefined });
      expect(result?.data).toEqual(plans);
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("when no run plans exist", () => {
    /** @scenario "List run plans when none exist" */
    it("says so rather than printing an empty table", async () => {
      listSpy.mockResolvedValue([]);

      const result = await listRunPlansCommand({});
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("No run plans found");
    });
  });

  describe("when --archived is given", () => {
    /** @scenario "List archived run plans as well" */
    it("asks the platform for archived plans too", async () => {
      await listRunPlansCommand({ archived: true });

      expect(listSpy).toHaveBeenCalledWith({ includeArchived: true });
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      listSpy.mockRejectedValue(
        new RunPlansApiError("Network error", "list run plans"),
      );

      await expect(listRunPlansCommand({})).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getRunPlanCommand()", () => {
  describe("when the plan is found", () => {
    /** @scenario "Get one run plan" */
    it("reads it by ID and returns it as the payload", async () => {
      const plan = makePlan();
      getSpy.mockResolvedValue(plan);

      const result = await getRunPlanCommand("plan_abc");

      expect(getSpy).toHaveBeenCalledWith("plan_abc");
      expect(result?.data).toEqual(plan);
    });
  });

  describe("when the plan is not found", () => {
    /** @scenario "Get a run plan that does not exist" */
    it("exits with code 1", async () => {
      getSpy.mockRejectedValue(
        new RunPlansApiError("Not found", 'get run plan "nonexistent-id"'),
      );

      await expect(getRunPlanCommand("nonexistent-id")).rejects.toThrow(
        ProcessExitError,
      );
    });
  });
});

describe("archiveRunPlanCommand()", () => {
  /** @scenario "Archive a run plan" */
  it("archives the plan by ID", async () => {
    const result = await archiveRunPlanCommand("plan_abc");

    expect(archiveSpy).toHaveBeenCalledWith("plan_abc");
    expect(result?.data).toEqual({ id: "plan_abc", archived: true });
  });
});

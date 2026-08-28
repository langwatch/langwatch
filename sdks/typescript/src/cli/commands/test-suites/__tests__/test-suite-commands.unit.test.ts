/**
 * The `test-suite` commands.
 *
 * A test suite is a group of scenarios: a name and the scenarios filed in it.
 * It holds no targets, so running one sends them with the request and the
 * platform files the run under a run plan.
 *
 * Spec: specs/features/test-suite-cli.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TestSuitesApiError } from "@/client-sdk/services/test-suites";

const listSpy = vi.hoisted(() => vi.fn());
const createSpy = vi.hoisted(() => vi.fn());
const getSpy = vi.hoisted(() => vi.fn());
const renameSpy = vi.hoisted(() => vi.fn());
const archiveSpy = vi.hoisted(() => vi.fn());
const runSpy = vi.hoisted(() => vi.fn());

vi.mock("../cli-test-suites-service", () => ({
  createCliTestSuitesService: vi.fn(() => ({
    list: listSpy,
    create: createSpy,
    get: getSpy,
    rename: renameSpy,
    archive: archiveSpy,
    run: runSpy,
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
    text: "",
  }),
}));

import { listTestSuitesCommand } from "../list";
import { createTestSuiteCommand } from "../create";
import { getTestSuiteCommand } from "../get";
import { renameTestSuiteCommand } from "../rename";
import { archiveTestSuiteCommand } from "../archive";
import { runTestSuiteCommand } from "../run";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const makeSuite = (overrides: Record<string, unknown> = {}) => ({
  id: "suite_abc",
  name: "Refunds",
  slug: "refunds",
  scenarioIds: ["scenario_1", "scenario_2"],
  scenarioCount: 2,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/proj-1/agent-testing",
  ...overrides,
});

const makeRunResult = (overrides: Record<string, unknown> = {}) => ({
  scheduled: true,
  batchRunId: "batch_123",
  setId: "set_456",
  jobCount: 2,
  skippedArchived: { scenarios: [], targets: [] },
  items: [],
  runPlanId: "plan_abc",
  planName: "Refunds against Support Agent",
  created: true,
  platformUrl: "https://app.langwatch.ai/proj-1/agent-testing/results",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  listSpy.mockResolvedValue([makeSuite()]);
  createSpy.mockResolvedValue(makeSuite({ scenarioIds: [], scenarioCount: 0 }));
  getSpy.mockResolvedValue({
    ...makeSuite(),
    scenarios: [
      { id: "scenario_1", name: "Refund a paid order" },
      { id: "scenario_2", name: "Refund a free order" },
    ],
  });
  renameSpy.mockResolvedValue(makeSuite({ name: "Refunds and credits" }));
  archiveSpy.mockResolvedValue({ id: "suite_abc", archived: true });
  runSpy.mockResolvedValue(makeRunResult());
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

describe("listTestSuitesCommand()", () => {
  describe("when test suites exist", () => {
    /** @scenario "List test suites" */
    it("returns the listing as the payload instead of printing it", async () => {
      const suites = [makeSuite()];
      listSpy.mockResolvedValue(suites);

      const result = await listTestSuitesCommand();

      expect(listSpy).toHaveBeenCalledOnce();
      expect(result?.data).toEqual(suites);
      expect(console.log).not.toHaveBeenCalled();
    });

    /** @scenario "List test suites" */
    it("shows the scenario count of each suite", async () => {
      const result = await listTestSuitesCommand();
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Refunds");
      expect(printed).toContain("Scenarios");
    });
  });

  describe("when no test suites exist", () => {
    /** @scenario "List test suites when none exist" */
    it("says so rather than printing an empty table", async () => {
      listSpy.mockResolvedValue([]);

      const result = await listTestSuitesCommand();
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("No test suites found");
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      listSpy.mockRejectedValue(
        new TestSuitesApiError("Network error", "list test suites"),
      );

      await expect(listTestSuitesCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createTestSuiteCommand()", () => {
  /** @scenario "Create a test suite" */
  it("creates it empty, with only a name", async () => {
    const result = await createTestSuiteCommand("Refunds");

    expect(createSpy).toHaveBeenCalledWith({ name: "Refunds" });
    expect(result?.data).toMatchObject({ scenarioCount: 0 });
  });
});

describe("getTestSuiteCommand()", () => {
  describe("when named by ID", () => {
    /** @scenario "Get a test suite by ID" */
    it("reads it and names the scenarios filed in it", async () => {
      const result = await getTestSuiteCommand("suite_abc");

      expect(getSpy).toHaveBeenCalledWith("suite_abc");
      expect(result?.data).toMatchObject({ id: "suite_abc" });

      result!.table();
      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Refund a paid order");
    });
  });

  describe("when named by name", () => {
    /** @scenario "Get a test suite by name" */
    it("resolves the name to its ID", async () => {
      await getTestSuiteCommand("Refunds");

      expect(getSpy).toHaveBeenCalledWith("suite_abc");
    });
  });

  describe("when the name matches nothing", () => {
    /** @scenario "Get a test suite that does not exist" */
    it("refuses and points at the listing", async () => {
      listSpy.mockResolvedValue([]);

      await expect(getTestSuiteCommand("nonexistent-id")).rejects.toThrow(
        ProcessExitError,
      );

      const reported = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(reported).toContain("not found");
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  describe("when two suites share the name", () => {
    /** @scenario "Get a name two test suites share" */
    it("refuses, naming both IDs", async () => {
      listSpy.mockResolvedValue([
        makeSuite({ id: "suite_1" }),
        makeSuite({ id: "suite_2" }),
      ]);

      await expect(getTestSuiteCommand("Refunds")).rejects.toThrow(
        ProcessExitError,
      );

      const reported = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(reported).toContain("suite_1");
      expect(reported).toContain("suite_2");
    });
  });
});

describe("renameTestSuiteCommand()", () => {
  /** @scenario "Rename a test suite" */
  it("renames it, keeping the slug", async () => {
    const result = await renameTestSuiteCommand("suite_abc", "Refunds and credits");

    expect(renameSpy).toHaveBeenCalledWith("suite_abc", {
      name: "Refunds and credits",
    });
    expect(result?.data).toMatchObject({ slug: "refunds" });
  });
});

describe("archiveTestSuiteCommand()", () => {
  /** @scenario "Archive a test suite" */
  it("archives it and says its scenarios went with it", async () => {
    const result = await archiveTestSuiteCommand("suite_abc");

    expect(archiveSpy).toHaveBeenCalledWith("suite_abc");
    expect(result?.data).toEqual({ id: "suite_abc", archived: true });

    result!.table();
    const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(printed).toContain("archived with it");
  });

  describe("when the suite does not exist", () => {
    /** @scenario "Archive a test suite that does not exist" */
    it("refuses before archiving anything", async () => {
      listSpy.mockResolvedValue([]);

      await expect(archiveTestSuiteCommand("nonexistent-id")).rejects.toThrow(
        ProcessExitError,
      );

      expect(archiveSpy).not.toHaveBeenCalled();
    });
  });
});

describe("runTestSuiteCommand()", () => {
  describe("when a target is given", () => {
    /** @scenario "Run a test suite" */
    it("sends the targets with the run", async () => {
      await runTestSuiteCommand({
        reference: "suite_abc",
        options: { target: ["http:agent_abc"] },
      });

      expect(runSpy).toHaveBeenCalledWith("suite_abc", {
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });
    });

    /** @scenario "Run a test suite" */
    it("reports the plan name, the job count and the batch run ID", async () => {
      await runTestSuiteCommand({
        reference: "suite_abc",
        options: { target: ["http:agent_abc"] },
      });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Refunds against Support Agent");
      expect(printed).toContain("batch_123");
    });
  });

  describe("when the suite is named by name", () => {
    /** @scenario "Run a test suite by name" */
    it("resolves the name to its ID", async () => {
      await runTestSuiteCommand({
        reference: "Refunds",
        options: { target: ["http:agent_abc"] },
      });

      expect(runSpy).toHaveBeenCalledWith("suite_abc", expect.anything());
    });
  });

  describe("when no target is given", () => {
    /** @scenario "Run a test suite with no target" */
    it("refuses before anything is scheduled", async () => {
      await expect(
        runTestSuiteCommand({ reference: "suite_abc", options: {} }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a plan name is given", () => {
    /** @scenario "Run a test suite under a plan name" */
    it("sends it, so the run joins that plan", async () => {
      await runTestSuiteCommand({
        reference: "suite_abc",
        options: { target: ["http:agent_abc"], name: "Nightly regression" },
      });

      expect(runSpy).toHaveBeenCalledWith(
        "suite_abc",
        expect.objectContaining({ name: "Nightly regression" }),
      );
    });
  });

  describe("when a repeat count and models are given", () => {
    /** @scenario "Run a test suite with a repeat count and models" */
    it("carries all three", async () => {
      await runTestSuiteCommand({
        reference: "suite_abc",
        options: {
          target: ["http:agent_abc"],
          repeat: "3",
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
        },
      });

      expect(runSpy).toHaveBeenCalledWith(
        "suite_abc",
        expect.objectContaining({
          repeatCount: 3,
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
        }),
      );
    });
  });

  describe("when a note is given", () => {
    /** @scenario "Run a test suite with a note" */
    it("sends it and shows it beside the batch run ID", async () => {
      await runTestSuiteCommand({
        reference: "suite_abc",
        options: {
          target: ["http:agent_abc"],
          note: "nightly regression after the retry fix",
        },
      });

      expect(runSpy).toHaveBeenCalledWith(
        "suite_abc",
        expect.objectContaining({
          note: "nightly regression after the retry fix",
        }),
      );

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("batch_123");
      expect(printed).toContain("nightly regression after the retry fix");
    });

    /** @scenario "Run a test suite with a note over two hundred characters" */
    it("refuses a note over the limit", async () => {
      await expect(
        runTestSuiteCommand({
          reference: "suite_abc",
          options: { target: ["http:agent_abc"], note: "x".repeat(201) },
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });

    /** @scenario "Run a test suite with a note of only spaces" */
    it("sends no note when it holds only spaces", async () => {
      await runTestSuiteCommand({
        reference: "suite_abc",
        options: { target: ["http:agent_abc"], note: "   " },
      });

      expect(runSpy.mock.calls[0]![1]).not.toHaveProperty("note");
    });
  });

  describe("when --wait is passed", () => {
    /** @scenario "Run a test suite and wait for completion" */
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

      await runTestSuiteCommand({
        reference: "suite_abc",
        options: { target: ["http:agent_abc"], wait: true },
      });

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      runSpy.mockRejectedValue(
        new TestSuitesApiError("Not found", 'run test suite "suite_abc"'),
      );

      await expect(
        runTestSuiteCommand({
          reference: "suite_abc",
          options: { target: ["http:agent_abc"] },
        }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

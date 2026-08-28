/**
 * `scenario run` is a run plan scoped to one case.
 *
 * It sends ONE request. No suite is created for it and none is deleted
 * afterwards, which is what the first assertions here pin: the old command
 * minted an ephemeral suite, ran it and cleaned it up, so a failure between
 * those steps left rubbish in the project.
 *
 * Spec: specs/features/scenario-cli.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const runSpy = vi.hoisted(() => vi.fn());
vi.mock("../../run-plans/cli-run-plans-service", () => ({
  createCliRunPlansService: vi.fn(() => ({ run: runSpy })),
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

import { createCliRunPlansService } from "../../run-plans/cli-run-plans-service";
import { runScenarioCommand } from "../run";

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
  batchRunId: "batch_1",
  setId: "set_1",
  jobCount: 1,
  skippedArchived: { scenarios: [], targets: [] },
  items: [],
  runPlanId: "plan_1",
  planName: "Login Flow against Support Agent",
  created: true,
  platformUrl: "https://app.langwatch.ai/proj-1/agent-testing/results",
  ...overrides,
});

describe("runScenarioCommand()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runSpy.mockResolvedValue(makeRunResult());
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  describe("when a target is given", () => {
    /** @scenario "Run a scenario against a target" */
    it("posts one run scoped to that one case", async () => {
      await runScenarioCommand("scenario_1", { target: ["http:agent_abc123"] });

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith({
        config: {
          scope: { mode: "cases" },
          scenarioIds: ["scenario_1"],
          targets: [{ type: "http", referenceId: "agent_abc123" }],
        },
      });
    });

    /** @scenario "Run a scenario against a target" */
    it("reports the plan name, the job count and the batch run ID", async () => {
      await runScenarioCommand("scenario_1", { target: ["http:agent_abc123"] });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Login Flow against Support Agent");
      expect(printed).toContain("batch_1");
    });
  });

  describe("when the run is sent", () => {
    /** @scenario "Running a scenario declares the command line as its surface" */
    it("goes through the service that declares the command line as its surface", async () => {
      await runScenarioCommand("scenario_1", { target: ["http:agent_abc123"] });

      expect(createCliRunPlansService).toHaveBeenCalled();
    });
  });

  describe("when more than one target is given", () => {
    /** @scenario "Run a scenario against more than one target" */
    it("sends both", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123", "prompt:prompt_xyz"],
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            targets: [
              { type: "http", referenceId: "agent_abc123" },
              { type: "prompt", referenceId: "prompt_xyz" },
            ],
          }),
        }),
      );
    });
  });

  describe("when a plan name is given", () => {
    /** @scenario "Run a scenario under a plan name" */
    it("sends it, so the run joins that plan", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123"],
        name: "Login checks",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Login checks" }),
      );
    });
  });

  describe("when a repeat count is given", () => {
    /** @scenario "Run a scenario more than once" */
    it("carries it in the configuration", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123"],
        repeat: "3",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ repeatCount: 3 }),
        }),
      );
    });
  });

  describe("when no target is given", () => {
    /** @scenario "Run a scenario with no target" */
    it("refuses before anything is scheduled", async () => {
      await expect(runScenarioCommand("scenario_1", {})).rejects.toThrow(
        ProcessExitError,
      );

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when --param pairs are given", () => {
    /** @scenario "Run a scenario against a target" */
    it("supplies them to the run, not to the configuration", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123"],
        param: ["account_tier=gold", "seats=12", "beta=true"],
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: { account_tier: "gold", seats: 12, beta: true },
        }),
      );
      expect(runSpy.mock.calls[0]![0].config).not.toHaveProperty("parameters");
    });
  });

  describe("when a --param pair has no equals sign", () => {
    /** @scenario "Run a scenario with no target" */
    it("refuses before anything is scheduled", async () => {
      await expect(
        runScenarioCommand("scenario_1", {
          target: ["http:agent_abc123"],
          param: ["account_tier"],
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when --note is given", () => {
    /** @scenario "Run a scenario with a note" */
    it("schedules the run with that note", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123"],
        note: "after the timeout fix",
      });

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ note: "after the timeout fix" }),
      );
    });

    /** @scenario "Run a scenario with a note" */
    it("shows the note in the confirmation", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123"],
        note: "after the timeout fix",
      });

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("after the timeout fix");
    });
  });

  describe("when --note is longer than the limit", () => {
    /** @scenario "Run a scenario with a note over two hundred characters" */
    it("refuses before anything is scheduled", async () => {
      await expect(
        runScenarioCommand("scenario_1", {
          target: ["http:agent_abc123"],
          note: "x".repeat(201),
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("when --note holds only spaces", () => {
    /** @scenario "Run a scenario with a note of only spaces" */
    it("schedules the run with no note", async () => {
      await runScenarioCommand("scenario_1", {
        target: ["http:agent_abc123"],
        note: "   ",
      });

      expect(runSpy.mock.calls[0]![0]).not.toHaveProperty("note");
    });
  });
});

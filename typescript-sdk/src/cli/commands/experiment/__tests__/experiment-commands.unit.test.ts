import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExperimentsApiServiceError } from "@/client-sdk/services/experiments/experiments-api.service";

vi.mock("@/client-sdk/services/experiments/experiments-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/experiments/experiments-api.service")>();
  return {
    ...actual,
    ExperimentsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
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

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { runExperimentCommand } from "../run";
import { experimentStatusCommand } from "../status";
import { addComparisonCommand, parseVariantSpec } from "../add-comparison";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("runExperimentCommand()", () => {
  let mockStartRun: ReturnType<typeof vi.fn>;
  let mockGetRunStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStartRun = vi.fn();
    mockGetRunStatus = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () { return ({
      startRun: mockStartRun,
      getRunStatus: mockGetRunStatus,
    }) as unknown as ExperimentsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when run starts successfully", () => {
    it("calls startRun with the slug", async () => {
      mockStartRun.mockResolvedValue({
        runId: "run_123",
        status: "running",
        total: 10,
      });

      await runExperimentCommand("quality-check", {});

      expect(mockStartRun).toHaveBeenCalledWith("quality-check");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = {
        runId: "run_123",
        status: "running",
        total: 10,
      };
      mockStartRun.mockResolvedValue(result);

      await runExperimentCommand("quality-check", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockStartRun.mockRejectedValue(
        new ExperimentsApiServiceError("Not found", "start evaluation run"),
      );

      await expect(
        runExperimentCommand("nonexistent", {}),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("experimentStatusCommand()", () => {
  let mockGetRunStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunStatus = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () { return ({
      startRun: vi.fn(),
      getRunStatus: mockGetRunStatus,
      getRunResults: vi
        .fn()
        .mockRejectedValue(
          new ExperimentsApiServiceError("Run not found", "get run results"),
        ),
      listRuns: vi.fn().mockResolvedValue({ runs: [{ runId: "run_123" }] }),
    }) as unknown as ExperimentsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when status is returned", () => {
    it("calls getRunStatus with the pinned run id", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "run_123",
        status: "completed",
        progress: 10,
        total: 10,
      });

      await experimentStatusCommand("doc-qa", { runId: "run_123" });

      expect(mockGetRunStatus).toHaveBeenCalledWith("run_123");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const status = {
        runId: "run_123",
        status: "completed",
        progress: 10,
        total: 10,
        summary: { completedCells: 10, duration: 5000 },
      };
      mockGetRunStatus.mockResolvedValue(status);

      await experimentStatusCommand("doc-qa", { runId: "run_123", format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(status, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetRunStatus.mockRejectedValue(
        new ExperimentsApiServiceError("Not found", "get run status"),
      );

      await expect(
        experimentStatusCommand("doc-qa", { runId: "nonexistent" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("parseVariantSpec()", () => {
  it("parses target:<id>", () => {
    expect(parseVariantSpec("target:target-a")).toEqual({
      kind: "existingTarget",
      targetId: "target-a",
    });
  });

  it("parses prompt:<handle>", () => {
    expect(parseVariantSpec("prompt:draft-v1")).toEqual({
      kind: "prompt",
      handle: "draft-v1",
    });
  });

  it("parses prompt:<handle>@<version>", () => {
    expect(parseVariantSpec("prompt:draft-v1@3")).toEqual({
      kind: "prompt",
      handle: "draft-v1",
      version: 3,
    });
  });

  it("parses agent:<id>", () => {
    expect(parseVariantSpec("agent:agent_123")).toEqual({
      kind: "agent",
      agentId: "agent_123",
    });
  });

  it("throws on an unknown prefix", () => {
    expect(() => parseVariantSpec("workflow:wf_1")).toThrow(/Invalid --variant/);
  });

  it("throws when the prefix has no value", () => {
    expect(() => parseVariantSpec("prompt:")).toThrow(/missing prompt handle/);
  });
});

describe("addComparisonCommand()", () => {
  let mockAttachComparison: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAttachComparison = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        attachComparison: mockAttachComparison,
      } as unknown as ExperimentsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when fewer than two --variant flags are given", () => {
    it("exits with code 1 without calling the API", async () => {
      await expect(
        addComparisonCommand("quality-check", { variant: ["prompt:draft-v1"] }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockAttachComparison).not.toHaveBeenCalled();
    });
  });

  describe("when two variants are given", () => {
    it("calls attachComparison with the parsed variants", async () => {
      mockAttachComparison.mockResolvedValue({
        comparisonTargetId: "target_new",
        createdTargetIds: [],
        reusedTargetIds: ["target-a", "target-b"],
        targets: [],
      });

      await addComparisonCommand("quality-check", {
        variant: ["target:target-a", "prompt:draft-v2"],
        goldenField: "expected_output",
      });

      expect(mockAttachComparison).toHaveBeenCalledWith({
        slug: "quality-check",
        body: {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "prompt", handle: "draft-v2" },
          ],
          goldenField: "expected_output",
          inputField: undefined,
          includeMetrics: undefined,
          randomizeOrder: undefined,
        },
      });
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = {
        comparisonTargetId: "target_new",
        createdTargetIds: ["target_new_variant"],
        reusedTargetIds: [],
        targets: [],
      };
      mockAttachComparison.mockResolvedValue(result);

      await addComparisonCommand("quality-check", {
        variant: ["prompt:draft-v1", "prompt:draft-v2"],
        format: "json",
      });

      expect(console.log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });
  });

  describe("when an invalid --variant spec is given", () => {
    it("exits with code 1 without calling the API", async () => {
      await expect(
        addComparisonCommand("quality-check", {
          variant: ["prompt:draft-v1", "not-a-valid-spec"],
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockAttachComparison).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockAttachComparison.mockRejectedValue(
        new ExperimentsApiServiceError("Experiment not found", "attach comparison"),
      );

      await expect(
        addComparisonCommand("quality-check", {
          variant: ["prompt:draft-v1", "prompt:draft-v2"],
        }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

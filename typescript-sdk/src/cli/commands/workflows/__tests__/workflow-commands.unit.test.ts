import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowsApiError } from "@/client-sdk/services/workflows/workflows-api.service";

vi.mock("@/client-sdk/services/workflows/workflows-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    WorkflowsApiService: vi.fn(),
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
  }),
}));

import { WorkflowsApiService } from "@/client-sdk/services/workflows/workflows-api.service";
import { listWorkflowsCommand } from "../list";
import { getWorkflowCommand } from "../get";
import { deleteWorkflowCommand } from "../delete";
import { updateWorkflowCommand } from "../update";

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

const makeWorkflow = (overrides = {}) => ({
  id: "workflow_abc123",
  name: "Test Workflow",
  icon: "🔄",
  description: "A test workflow",
  isEvaluator: false,
  isComponent: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  ...overrides,
});

describe("listWorkflowsCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    vi.mocked(WorkflowsApiService).mockImplementation(() => ({
      getAll: mockGetAll,
      get: vi.fn(),
      delete: vi.fn(),
    }) as unknown as WorkflowsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when workflows exist", () => {
    it("calls getAll and prints output", async () => {
      mockGetAll.mockResolvedValue([makeWorkflow()]);

      await listWorkflowsCommand();

      expect(mockGetAll).toHaveBeenCalledOnce();
    });
  });

  describe("when no workflows exist", () => {
    it("prints empty-state message", async () => {
      mockGetAll.mockResolvedValue([]);

      await listWorkflowsCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const workflows = [makeWorkflow()];
      mockGetAll.mockResolvedValue(workflows);

      await listWorkflowsCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(workflows, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockRejectedValue(
        new WorkflowsApiError("Network error", "list workflows"),
      );

      await expect(listWorkflowsCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getWorkflowCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(WorkflowsApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: mockGet,
      delete: vi.fn(),
    }) as unknown as WorkflowsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when workflow is found", () => {
    it("calls get with the provided ID", async () => {
      mockGet.mockResolvedValue(makeWorkflow());

      await getWorkflowCommand("workflow_abc123");

      expect(mockGet).toHaveBeenCalledWith("workflow_abc123");
    });
  });

  describe("when workflow is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new WorkflowsApiError("Not found", "get workflow"),
      );

      await expect(getWorkflowCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("deleteWorkflowCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    mockDelete = vi.fn();
    vi.mocked(WorkflowsApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: mockGet,
      delete: mockDelete,
    }) as unknown as WorkflowsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when workflow exists and deletion succeeds", () => {
    it("resolves the workflow then deletes it", async () => {
      mockGet.mockResolvedValue(makeWorkflow());
      mockDelete.mockResolvedValue({ id: "workflow_abc123", archived: true });

      await deleteWorkflowCommand("workflow_abc123");

      expect(mockGet).toHaveBeenCalledWith("workflow_abc123");
      expect(mockDelete).toHaveBeenCalledWith("workflow_abc123");
    });
  });

  describe("when workflow is not found", () => {
    it("exits with code 1 without calling delete", async () => {
      mockGet.mockRejectedValue(
        new WorkflowsApiError("Not found", "get workflow"),
      );

      await expect(deleteWorkflowCommand("nonexistent")).rejects.toThrow(ProcessExitError);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});

describe("updateWorkflowCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  describe("when update succeeds", () => {
    it("sends PATCH request with the updated fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeWorkflow({ name: "New Name" }),
      });

      await updateWorkflowCommand("workflow_abc123", { name: "New Name" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/workflows/workflow_abc123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "New Name" }),
        }),
      );
    });
  });

  describe("when no fields are provided", () => {
    it("exits with code 1", async () => {
      await expect(
        updateWorkflowCommand("workflow_abc123", {}),
      ).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when API returns 404", () => {
    it("exits with code 1", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => '{"error":"Workflow not found"}',
      });

      await expect(
        updateWorkflowCommand("nonexistent", { name: "X" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

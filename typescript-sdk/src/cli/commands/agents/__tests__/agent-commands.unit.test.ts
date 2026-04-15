import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentsApiError } from "@/client-sdk/services/agents/agents-api.service";

vi.mock("@/client-sdk/services/agents/agents-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AgentsApiService: vi.fn(),
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

import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { listAgentsCommand } from "../list";
import { getAgentCommand } from "../get";
import { createAgentCommand } from "../create";
import { deleteAgentCommand } from "../delete";

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

const makeAgent = (overrides = {}) => ({
  id: "agent_abc123",
  name: "Test Agent",
  type: "http",
  config: { url: "https://api.example.com" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  ...overrides,
});

describe("listAgentsCommand()", () => {
  let mockList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList = vi.fn();
    vi.mocked(AgentsApiService).mockImplementation(() => ({
      list: mockList,
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }) as unknown as AgentsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when agents exist", () => {
    it("calls list and prints output", async () => {
      mockList.mockResolvedValue({
        data: [makeAgent()],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });

      await listAgentsCommand();

      expect(mockList).toHaveBeenCalledOnce();
    });
  });

  describe("when no agents exist", () => {
    it("prints empty-state message", async () => {
      mockList.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      });

      await listAgentsCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = {
        data: [makeAgent()],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      };
      mockList.mockResolvedValue(result);

      await listAgentsCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockList.mockRejectedValue(
        new AgentsApiError("Network error", "list agents"),
      );

      await expect(listAgentsCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getAgentCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(AgentsApiService).mockImplementation(() => ({
      list: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }) as unknown as AgentsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when agent is found", () => {
    it("calls get with the provided ID", async () => {
      mockGet.mockResolvedValue(makeAgent());

      await getAgentCommand("agent_abc123");

      expect(mockGet).toHaveBeenCalledWith("agent_abc123");
    });
  });

  describe("when agent is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new AgentsApiError("Not found", "get agent"),
      );

      await expect(getAgentCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createAgentCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(AgentsApiService).mockImplementation(() => ({
      list: vi.fn(),
      get: vi.fn(),
      create: mockCreate,
      update: vi.fn(),
      delete: vi.fn(),
    }) as unknown as AgentsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when creation succeeds", () => {
    it("calls create with name, type, and config", async () => {
      mockCreate.mockResolvedValue(makeAgent());

      await createAgentCommand("Test Agent", {
        type: "http",
        config: '{"url":"https://api.example.com"}',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        name: "Test Agent",
        type: "http",
        config: { url: "https://api.example.com" },
      });
    });
  });

  describe("when config is invalid JSON", () => {
    it("exits with code 1 with JSON error", async () => {
      await expect(
        createAgentCommand("Test", { type: "http", config: "not-json" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when creation fails", () => {
    it("exits with code 1", async () => {
      mockCreate.mockRejectedValue(
        new AgentsApiError("Limit reached", "create agent"),
      );

      await expect(
        createAgentCommand("Test", { type: "http" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("deleteAgentCommand()", () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete = vi.fn();
    vi.mocked(AgentsApiService).mockImplementation(() => ({
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: mockDelete,
    }) as unknown as AgentsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when deletion succeeds", () => {
    it("calls delete with the ID", async () => {
      mockDelete.mockResolvedValue({ id: "agent_abc123", name: "Test Agent" });

      await deleteAgentCommand("agent_abc123");

      expect(mockDelete).toHaveBeenCalledWith("agent_abc123");
    });
  });

  describe("when deletion fails", () => {
    it("exits with code 1", async () => {
      mockDelete.mockRejectedValue(
        new AgentsApiError("Not found", "delete agent"),
      );

      await expect(deleteAgentCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

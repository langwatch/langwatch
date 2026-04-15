import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { listTriggersCommand } from "../list";
import { getTriggerCommand } from "../get";
import { createTriggerCommand } from "../create";
import { updateTriggerCommand } from "../update";
import { deleteTriggerCommand } from "../delete";

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

const makeTrigger = (overrides = {}) => ({
  id: "trigger_abc",
  name: "Error Alert",
  action: "SEND_EMAIL",
  actionParams: {},
  filters: {},
  active: true,
  message: "An error occurred",
  alertType: "CRITICAL",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("listTriggersCommand()", () => {
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

  describe("when triggers exist", () => {
    it("fetches and displays triggers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [makeTrigger()],
      });

      await listTriggersCommand();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/triggers"),
        expect.objectContaining({ headers: expect.objectContaining({ "X-Auth-Token": "test-key" }) }),
      );
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const triggers = [makeTrigger()];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => triggers,
      });

      await listTriggersCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(JSON.stringify(triggers, null, 2));
    });
  });
});

describe("getTriggerCommand()", () => {
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

  describe("when trigger is found", () => {
    it("fetches and displays details", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeTrigger(),
      });

      await getTriggerCommand("trigger_abc");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc",
        expect.anything(),
      );
    });
  });

  describe("when trigger is not found", () => {
    it("exits with code 1", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(getTriggerCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createTriggerCommand()", () => {
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

  describe("when valid action is provided", () => {
    it("creates the trigger", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeTrigger(),
      });

      await createTriggerCommand("Error Alert", { action: "SEND_EMAIL" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("SEND_EMAIL"),
        }),
      );
    });
  });

  describe("when invalid action is provided", () => {
    it("exits with code 1", async () => {
      await expect(
        createTriggerCommand("Bad", { action: "INVALID" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("updateTriggerCommand()", () => {
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

  describe("when disabling a trigger", () => {
    it("sends PATCH with active=false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeTrigger({ active: false }),
      });

      await updateTriggerCommand("trigger_abc", { active: "false" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("false"),
        }),
      );
    });
  });
});

describe("deleteTriggerCommand()", () => {
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

  describe("when trigger exists", () => {
    it("deletes the trigger", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "trigger_abc", deleted: true }),
      });

      await deleteTriggerCommand("trigger_abc");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});

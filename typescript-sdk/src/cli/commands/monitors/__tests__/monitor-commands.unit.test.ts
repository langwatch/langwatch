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

import { listMonitorsCommand } from "../list";
import { getMonitorCommand } from "../get";
import { createMonitorCommand } from "../create";
import { updateMonitorCommand } from "../update";
import { deleteMonitorCommand } from "../delete";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

const makeMonitor = (overrides = {}) => ({
  id: "mon_abc",
  name: "Toxicity Check",
  slug: "toxicity-check-x1y2z",
  checkType: "ragas/toxicity",
  enabled: true,
  executionMode: "ON_MESSAGE",
  sample: 1.0,
  level: "trace",
  evaluatorId: null,
  preconditions: [],
  parameters: {},
  mappings: {},
  threadIdleTimeout: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("listMonitorsCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("lists monitors in table format", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [makeMonitor(), makeMonitor({ id: "mon_def", name: "PII Check" })],
    });

    await listMonitorsCommand();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/monitors"),
      expect.any(Object)
    );
  });

  it("outputs JSON when format is json", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [makeMonitor()],
    });

    await listMonitorsCommand({ format: "json" });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Toxicity Check")
    );
  });

  it("exits on API error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal" });
    await expect(listMonitorsCommand()).rejects.toThrow(ProcessExitError);
  });
});

describe("getMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("displays monitor details", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeMonitor(),
    });

    await getMonitorCommand("mon_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/monitors/mon_abc"),
      expect.any(Object)
    );
  });

  it("exits when monitor not found", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    await expect(getMonitorCommand("nonexistent")).rejects.toThrow(ProcessExitError);
  });
});

describe("createMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("creates a monitor", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeMonitor(),
    });

    await createMonitorCommand("Toxicity Check", { checkType: "ragas/toxicity" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/monitors"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("ragas/toxicity"),
      })
    );
  });

  it("rejects invalid execution mode", async () => {
    await expect(
      createMonitorCommand("Test", { checkType: "ragas/toxicity", executionMode: "INVALID" })
    ).rejects.toThrow(ProcessExitError);
  });
});

describe("updateMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("updates a monitor", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeMonitor({ enabled: false }),
    });

    await updateMonitorCommand("mon_abc", { enabled: "false" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/monitors/mon_abc"),
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("exits when monitor not found", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    await expect(
      updateMonitorCommand("bad_id", { name: "New Name" })
    ).rejects.toThrow(ProcessExitError);
  });
});

describe("deleteMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("deletes a monitor", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mon_abc", deleted: true }),
    });

    await deleteMonitorCommand("mon_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/monitors/mon_abc"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("exits when monitor not found", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    await expect(deleteMonitorCommand("bad_id")).rejects.toThrow(ProcessExitError);
  });
});

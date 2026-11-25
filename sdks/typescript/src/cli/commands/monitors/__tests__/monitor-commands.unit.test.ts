import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

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
  }),
}));

import { applyOutputContext, resolveOutputOptions } from "../../../utils/output";
import { createMonitorCommand } from "../create";
import { deleteMonitorCommand } from "../delete";
import { getMonitorCommand } from "../get";
import { listMonitorsCommand } from "../list";
import { updateMonitorCommand } from "../update";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => undefined;

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
    global.fetch = mockFetch as unknown as typeof fetch;
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
      expect.stringContaining("/api/v1/monitors"),
      expect.any(Object),
    );
  });

  describe("when a machine format is requested", () => {
    it("returns the raw monitor list as the payload instead of printing", async () => {
      const monitors = [makeMonitor()];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => monitors,
      });

      const result = await listMonitorsCommand();

      // The command no longer decides the format — it hands the payload to
      // the output port, which renders json/yaml/agents/--jq from this value.
      expect(result?.data).toEqual(monitors);
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  it("exits on API error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal" });
    await expect(listMonitorsCommand()).rejects.toThrow(ProcessExitError);
  });
});

const jsonError = async (run: () => Promise<unknown>) => {
  await applyOutputContext(resolveOutputOptions({ output: "json" }, {}));
  await expect(run()).rejects.toThrow(ProcessExitError);
  // process.exit is mocked to throw inside the command's try, so a second document can follow.
  const doc = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0])) as {
    error: { code: string; message: string };
  };
  await applyOutputContext(resolveOutputOptions({}, {}));
  return doc.error;
};

describe("getMonitorCommand()", () => {
  let mockFetch: Mock<(url: string) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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
      expect.stringContaining("/api/v1/monitors/mon_abc"),
      expect.any(Object),
    );
  });

  it("exits when monitor not found", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });
    await expect(getMonitorCommand("nonexistent")).rejects.toThrow(ProcessExitError);
  });

  const notFoundThenList = (rows: unknown[]) => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/api/v1/monitors")
          ? { ok: true, status: 200, json: async () => rows }
          : { ok: false, status: 404, text: async () => '{"error":"monitor_not_found"}' },
      ),
    );
  };

  describe("when the reference is a display name, not an id", () => {
    /** @scenario Get a monitor by display name */
    it("returns the monitor with that name", async () => {
      notFoundThenList([makeMonitor({ id: "mon_xyz", name: "Toxicity Check" })]);

      const result = await getMonitorCommand("toxicity check");

      expect((result as { data: { id: string } }).data.id).toBe("mon_xyz");
    });
  });

  describe("when nothing matches the reference", () => {
    /** @scenario Get a monitor by a name nothing matches */
    it("fails with the monitor_not_found code", async () => {
      notFoundThenList([makeMonitor()]);

      expect((await jsonError(() => getMonitorCommand("ghost"))).code).toBe("monitor_not_found");
    });
  });

  describe("when two monitors share the display name", () => {
    it("fails with a validation_error listing both ids", async () => {
      notFoundThenList([
        makeMonitor({ id: "mon_1", slug: "a", name: "Twin" }),
        makeMonitor({ id: "mon_2", slug: "b", name: "Twin" }),
      ]);

      const error = await jsonError(() => getMonitorCommand("Twin"));

      expect(error.code).toBe("validation_error");
      expect(error.message).toContain("mon_1, mon_2");
    });
  });
});

describe("createMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("creates a monitor", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeMonitor({ evaluatorId: "eval_abc" }),
    });

    await createMonitorCommand("Toxicity Check", {
      checkType: "ragas/toxicity",
      evaluatorId: "eval_abc",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/monitors"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("ragas/toxicity"),
      }),
    );
  });

  it("rejects invalid execution mode", async () => {
    await expect(
      createMonitorCommand("Test", {
        checkType: "ragas/toxicity",
        evaluatorId: "eval_abc",
        executionMode: "INVALID",
      }),
    ).rejects.toThrow(ProcessExitError);
  });

  describe("when --evaluator-id is missing", () => {
    /** @scenario The CLI refuses to create a monitor without --evaluator-id */
    it("fails before calling the API and points at evaluator create and list", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(noop);

      await expect(createMonitorCommand("Test", { checkType: "ragas/toxicity" })).rejects.toThrow(
        ProcessExitError,
      );

      expect(mockFetch).not.toHaveBeenCalled();
      const output = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      // The stable machine contract is the code; the prose is supplementary.
      expect(output).toContain("validation_error");
      expect(output).toContain("--evaluator-id is required");
      expect(output).toContain("langwatch evaluator create");
      expect(output).toContain("langwatch evaluator list");
    });
  });
});

describe("updateMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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
      expect.stringContaining("/api/v1/monitors/mon_abc"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("exits when monitor not found", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });
    await expect(updateMonitorCommand("bad_id", { name: "New Name" })).rejects.toThrow(
      ProcessExitError,
    );
  });
});

describe("deleteMonitorCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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
      expect.stringContaining("/api/v1/monitors/mon_abc"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("exits when monitor not found", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });
    await expect(deleteMonitorCommand("bad_id")).rejects.toThrow(ProcessExitError);
  });

  describe("when given a display name", () => {
    /** @scenario Delete a monitor by display name is refused */
    it("says to find the id with monitor get", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });

      const error = await jsonError(() => deleteMonitorCommand("Toxicity Check"));

      expect(error.message).toContain("langwatch monitor get <name>");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "test-key", source: "env", endpoint: "https://app.langwatch.ai" })),
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
import { setTriggerActiveCommand } from "../setActive";
import { testFireTriggerCommand } from "../testFire";
import { triggerFiresCommand } from "../fires";

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
    global.fetch = mockFetch as unknown as typeof fetch;
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
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer test-key",
            "x-auth-token": "test-key",
          }),
        }),
      );
    });
  });

  describe("when the table is printed", () => {
    it("shows each automation's kind, query and rule", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          makeTrigger({ kind: "AUTOMATION", filterQuery: "status:error" }),
          makeTrigger({
            id: "trigger_def",
            kind: "REPORT",
            report: {
              source: { kind: "customGraph", customGraphId: "graph_1" },
              schedule: { cron: "0 8 * * *", timezone: "UTC" },
            },
          }),
        ],
      });

      const result = await listTriggersCommand();
      result?.table?.();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Kind");
      expect(printed).toContain("status:error");
      expect(printed).toContain("REPORT");
      expect(printed).toContain('graph graph_1 at "0 8 * * *" UTC');
    });
  });

  describe("when a machine format is requested", () => {
    it("returns the raw trigger list as the payload instead of printing", async () => {
      const triggers = [makeTrigger()];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => triggers,
      });

      const result = await listTriggersCommand();

      // The command no longer decides the format — it hands the payload to
      // the output port, which renders json/yaml/agents/--jq from this value.
      expect(result?.data).toEqual(triggers);
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});

describe("getTriggerCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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

  describe("when a machine format is requested", () => {
    // Machine output is the more exposed surface — it gets logged, piped and
    // pasted into agent context. It carries what the API answered, and the API
    // answers with delivery credentials replaced by the `[redacted]`
    // placeholder, so the command hands the response through untouched.
    /** @scenario "The command line prints what the API returned" */
    it("returns the response payload as the API sent it", async () => {
      const trigger = makeTrigger({
        action: "SEND_SLACK_MESSAGE",
        actionParams: { slackWebhook: "[redacted]" },
      });
      mockFetch.mockResolvedValue({ ok: true, json: async () => trigger });

      const result = await getTriggerCommand("trigger_abc");

      expect(result?.data).toEqual(trigger);
    });
  });

  describe("when the automation is an alert with a query", () => {
    it("prints its kind, query and a one-line rule", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          makeTrigger({
            kind: "ALERT",
            filterQuery: "status:error",
            customGraphId: "graph_1",
            graphAlert: { seriesName: "p95", operator: "gt", threshold: 2000, timePeriod: 5 },
            report: null,
          }),
      });

      const result = await getTriggerCommand("trigger_abc");
      result?.table?.();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("ALERT");
      expect(printed).toContain("status:error");
      expect(printed).toContain("p95 > 2000 over 5m on graph graph_1");
    });
  });

  describe("when the automation is a report", () => {
    it("prints a one-line report summary", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          makeTrigger({
            kind: "REPORT",
            report: {
              source: { kind: "dashboard", dashboardId: "dash_1" },
              schedule: { cron: "0 9 * * 1", timezone: "UTC" },
              compareToPrevious: true,
            },
          }),
      });

      const result = await getTriggerCommand("trigger_abc");
      result?.table?.();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain('dashboard dash_1 at "0 9 * * 1" UTC, vs previous');
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
    global.fetch = mockFetch as unknown as typeof fetch;
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
  describe("when an alert on a graph is created", () => {
    it("sends the graph, its rule and the query", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeTrigger({ kind: "ALERT" }) });

      await createTriggerCommand("Latency", {
        action: "SEND_EMAIL",
        customGraphId: "graph_1",
        graphAlert: '{"seriesName":"p95","operator":"gt","threshold":2000,"timePeriod":5}',
        filterQuery: "status:error",
      });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body).toMatchObject({
        customGraphId: "graph_1",
        graphAlert: { seriesName: "p95", threshold: 2000 },
        filterQuery: "status:error",
      });
    });
  });

  describe("when a scheduled report is created", () => {
    it("sends the report as stated", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeTrigger({ kind: "REPORT" }) });
      const report = {
        source: { kind: "dashboard", dashboardId: "dash_1" },
        schedule: { cron: "0 9 * * 1", timezone: "UTC" },
      };

      await createTriggerCommand("Monday", {
        action: "SEND_EMAIL",
        report: JSON.stringify(report),
      });

      expect(JSON.parse(mockFetch.mock.calls[0]?.[1]?.body).report).toEqual(report);
    });

    it("refuses a report that is not a JSON object", async () => {
      await expect(
        createTriggerCommand("Monday", { action: "SEND_EMAIL", report: "[1]" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe("updateTriggerCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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
  describe("when an alert's rule or a report is changed", () => {
    it("sends the rule and the report", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeTrigger() });

      await updateTriggerCommand("trigger_abc", {
        graphAlert: '{"seriesName":"p95","operator":"lt","threshold":1,"timePeriod":15}',
        report: '{"source":{"kind":"traceQuery"},"schedule":{"cron":"0 8 * * *","timezone":"UTC"}}',
      });

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body).toMatchObject({
        graphAlert: { operator: "lt" },
        report: { source: { kind: "traceQuery" } },
      });
    });
  });
});

describe("setTriggerActiveCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  describe("when the trigger is paused", () => {
    it("calls the verb that says so", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeTrigger({ active: false }),
      });

      await setTriggerActiveCommand({ id: "trigger_abc", active: false });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc/disable",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("when the trigger is resumed", () => {
    it("calls the verb that says so", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeTrigger({ active: true }),
      });

      await setTriggerActiveCommand({ id: "trigger_abc", active: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc/enable",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});

describe("testFireTriggerCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  describe("when the automation has a destination", () => {
    it("asks the API to send to it and returns what came back", async () => {
      const result = {
        channel: "email",
        recipientCount: 2,
        usedDefault: true,
        missingVariables: [],
        errors: [],
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => result });

      const command = await testFireTriggerCommand("trigger_abc");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc/test-fire",
        expect.objectContaining({ method: "POST" }),
      );
      expect(command?.data).toEqual(result);
    });
  });
});

describe("triggerFiresCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  describe("when a limit is given", () => {
    it("asks for that many fires", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });

      await triggerFiresCommand("trigger_abc", { limit: "5" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc/fires?limit=5",
        expect.anything(),
      );
    });
  });

  describe("when a cursor is given", () => {
    it("asks for the page after it and prints the next cursor", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          fires: [{ id: "fire_2", firedAt: "2026-01-02T00:00:00Z", resolvedAt: null }],
          nextCursor: "cursor_3",
        }),
      });

      const result = await triggerFiresCommand("trigger_abc", { limit: "1", cursor: "cursor_2" });
      result?.table?.();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:5560/api/triggers/trigger_abc/fires?limit=1&cursor=cursor_2",
        expect.anything(),
      );
      expect(result?.data).toMatchObject({ nextCursor: "cursor_3" });
      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("--cursor cursor_3");
    });
  });

  describe("when an older deployment answers with a bare list", () => {
    it("reads it as the last page", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });

      const result = await triggerFiresCommand("trigger_abc");

      expect(result?.data).toEqual({ fires: [], nextCursor: null });
    });
  });
});

describe("deleteTriggerCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
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

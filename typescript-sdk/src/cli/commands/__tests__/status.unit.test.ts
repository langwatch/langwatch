import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock createLangWatchApiClient so we can return controlled responses for every
// endpoint the status command queries. Status hits ~10 resources plus the
// attention sections (trace search POST, experiments GET) in parallel; we want
// a deterministic mix of success/failure per test.
const mockGET = vi.fn();
const mockPOST = vi.fn();
vi.mock("@/internal/api/client", () => ({
  createLangWatchApiClient: () => ({ GET: mockGET, POST: mockPOST }),
}));

vi.mock("../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

import { statusCommand } from "../status";

// status renders its command cheat-sheet via buildProgram(), which reads the
// tsup-injected __CLI_VERSION__ build constant — stub it for the in-process
// test run (no bundler define under vitest).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const AGENT_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "GITHUB_COPILOT",
  "AMAZON_Q",
  "LW_AGENT_MODE",
  "LANGWATCH_AGENT_MODE",
];

/** Force the human (table) output path: agent-mode env vars would flip the
 * output to compact JSON and skip the human rendering entirely. */
const clearAgentEnv = (): Record<string, string | undefined> => {
  const saved: Record<string, string | undefined> = {};
  for (const name of AGENT_ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  return saved;
};

const restoreAgentEnv = (saved: Record<string, string | undefined>): void => {
  for (const name of Object.keys(saved)) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
};

const noExperiments = {
  experiments: [],
  pagination: { page: 1, pageSize: 50, totalHits: 0, hasMore: false },
};

/** Routing mocks where every resource + attention section succeeds clean:
 * zero errored traces, no experiments, no budgets. */
const mockAllSuccess = (): void => {
  mockGET.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/experiments")) {
      return { data: noExperiments, error: undefined, response: { status: 200 } };
    }
    return { data: [{ id: "1" }, { id: "2" }], error: undefined };
  });
  mockPOST.mockResolvedValue({
    data: { traces: [], pagination: { totalHits: 0 } },
    error: undefined,
    response: { status: 200 },
  });
  global.fetch = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/gateway/v1/budgets")) {
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
    return { ok: true, status: 200, json: async () => [{ id: "1" }] };
  }) as unknown as typeof fetch;
};

describe("statusCommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError((code as number) ?? 0);
    });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:9876";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("when every resource fetch fails with 401", () => {
    beforeEach(() => {
      // openapi-fetch returns { error, response } on !ok, not { data }.
      mockGET.mockResolvedValue({
        data: undefined,
        error: { error: "Unauthorized", message: "Invalid API key" },
        response: { status: 401 } as Response,
      });
      mockPOST.mockResolvedValue({
        data: undefined,
        error: { error: "Unauthorized", message: "Invalid API key" },
        response: { status: 401 } as Response,
      });
      // suites/triggers/monitors/secrets (and the budgets section) use raw fetch.
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "Unauthorized", message: "Invalid API key" }),
      }) as unknown as typeof fetch;
    });

    it("prints an auth-specific diagnostic", async () => {
      await expect(statusCommand()).rejects.toThrow(ProcessExitError);

      const combined = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join("\n");

      // The user needs to know that (1) fetches failed, (2) the reason is auth,
      // and (3) what to do next. Without this they see a grid of "fetch failed".
      expect(combined).toContain("Could not fetch any project resources");
      expect(combined).toContain("Invalid API key");
      expect(combined).toContain("langwatch login");
    });

    it("exits with code 1 so scripts can detect the failure", async () => {
      await expect(statusCommand()).rejects.toMatchObject({ code: 1 });
    });

    it("machine output still exits 0 with every failure IN the document", async () => {
      // A machine caller must get a parseable document and a success exit even
      // when everything failed — the failures are data, not a crash.
      await statusCommand({ output: "json" });

      const doc = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
      expect(doc.resources.evaluators.error).toContain("Invalid API key");
      expect(doc.attention.erroredTraces24h).toBeNull();
      expect(doc.attention.runningExperiments).toBeNull();
      expect(doc.attention.budgetsAtRisk).toBeNull();
      expect(Object.keys(doc.attention.errors)).toEqual(
        expect.arrayContaining([
          "erroredTraces24h",
          "runningExperiments",
          "budgetsAtRisk",
        ]),
      );
    });
  });

  describe("when every resource fetch fails with a non-auth status", () => {
    beforeEach(() => {
      mockGET.mockResolvedValue({
        data: undefined,
        error: { error: "ServiceUnavailable", message: "Backend down" },
        response: { status: 503 } as Response,
      });
      mockPOST.mockResolvedValue({
        data: undefined,
        error: { error: "ServiceUnavailable", message: "Backend down" },
        response: { status: 503 } as Response,
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({ error: "ServiceUnavailable", message: "Backend down" }),
      }) as unknown as typeof fetch;
    });

    it("hints at LANGWATCH_API_KEY and reminds the user which endpoint is in use", async () => {
      await expect(statusCommand()).rejects.toThrow(ProcessExitError);

      const combined = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join("\n");

      // When it's not auth (e.g. 503), we shouldn't falsely claim the key is
      // invalid — show the endpoint so the user can verify it instead.
      expect(combined).not.toContain("langwatch login");
      expect(combined).toContain("http://localhost:9876");
      expect(combined).toContain("LANGWATCH_API_KEY");
    });
  });

  describe("when network fails entirely (ECONNREFUSED)", () => {
    beforeEach(() => {
      const cause = Object.assign(new Error(""), { code: "ECONNREFUSED" });
      const err = Object.assign(new TypeError("fetch failed"), { cause });
      mockGET.mockRejectedValue(err);
      mockPOST.mockRejectedValue(err);
      global.fetch = vi.fn().mockRejectedValue(err) as unknown as typeof fetch;
    });

    it("surfaces ECONNREFUSED in the diagnostic", async () => {
      await expect(statusCommand()).rejects.toThrow(ProcessExitError);

      const combined = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join("\n");

      expect(combined).toContain("ECONNREFUSED");
      expect(combined).toContain("http://localhost:9876");
    });
  });

  describe("when every resource fetch succeeds", () => {
    let savedAgentEnv: Record<string, string | undefined>;

    beforeEach(() => {
      mockAllSuccess();
      savedAgentEnv = clearAgentEnv();
    });

    afterEach(() => {
      restoreAgentEnv(savedAgentEnv);
    });

    it("prints the generated command cheat-sheet (resource groups, no plumbing)", async () => {
      await statusCommand();

      const out = consoleLogSpy.mock.calls.flat().join("\n");

      expect(out).toContain("Available CLI commands:");
      // Generated from the live catalog: groups with one-line descriptions.
      expect(out).toContain("langwatch trace");
      expect(out).toContain("Search and inspect traces");
      expect(out).toContain("langwatch virtual-keys");
      // CLI plumbing stays out of the resource summary.
      expect(out).not.toContain("langwatch login");
      expect(out).not.toContain("langwatch daemon");
      // Points at the full catalog instead of a hand-maintained list.
      expect(out).toContain("langwatch commands");
    });

    it("reports that nothing needs attention when all sections are clean", async () => {
      await statusCommand();

      const out = consoleLogSpy.mock.calls.flat().join("\n");
      expect(out).toContain("Needs Attention:");
      expect(out).toContain("nothing needs your attention");
    });
  });

  describe("attention sections", () => {
    let savedAgentEnv: Record<string, string | undefined>;

    beforeEach(() => {
      savedAgentEnv = clearAgentEnv();
    });

    afterEach(() => {
      restoreAgentEnv(savedAgentEnv);
    });

    it("flags errored traces, a running experiment and an at-risk budget", async () => {
      mockGET.mockImplementation(async (path: string) => {
        if (path.startsWith("/api/experiments/runs")) {
          return {
            data: {
              runs: [
                {
                  experimentId: "exp_1",
                  runId: "run_1",
                  workflowVersion: null,
                  // No finishedAt/stoppedAt → still running.
                  timestamps: { createdAt: 1, updatedAt: 2, finishedAt: null, stoppedAt: null },
                  progress: 5,
                  total: 10,
                  summary: { evaluations: {} },
                },
              ],
              pagination: { page: 1, pageSize: 1, totalHits: 1, hasMore: false },
            },
            error: undefined,
            response: { status: 200 },
          };
        }
        if (path.startsWith("/api/experiments")) {
          return {
            data: {
              experiments: [
                {
                  id: "exp_1",
                  slug: "eval-x",
                  name: "Eval X",
                  type: "EVALUATIONS_V3",
                  workflowId: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  runsCount: 3,
                  lastRunAt: new Date().toISOString(),
                },
              ],
              pagination: { page: 1, pageSize: 50, totalHits: 1, hasMore: false },
            },
            error: undefined,
            response: { status: 200 },
          };
        }
        return { data: [{ id: "1" }], error: undefined };
      });
      mockPOST.mockResolvedValue({
        data: { traces: [{ traceId: "t1" }], pagination: { totalHits: 7 } },
        error: undefined,
        response: { status: 200 },
      });
      global.fetch = vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/gateway/v1/budgets")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "bud_1",
                  organization_id: "org_1",
                  scope_type: "PROJECT",
                  scope_id: "proj_1",
                  name: "prod",
                  description: null,
                  window: "MONTH",
                  on_breach: "BLOCK",
                  limit_usd: "100",
                  spent_usd: "92",
                  timezone: null,
                  current_period_started_at: new Date().toISOString(),
                  resets_at: new Date().toISOString(),
                  last_reset_at: null,
                  archived_at: null,
                  created_at: new Date().toISOString(),
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => [{ id: "1" }] };
      }) as unknown as typeof fetch;

      await statusCommand();

      const out = consoleLogSpy.mock.calls.flat().join("\n");
      expect(out).toContain("Needs Attention:");
      expect(out).toContain("7 traces errored in the last 24h");
      expect(out).toContain('experiment "Eval X" is still running (5/10)');
      expect(out).toContain("langwatch experiment status eval-x --run-id run_1");
      expect(out).toContain('budget "prod" (month, project) at 92%');
      expect(out).toContain("blocks on breach");
      expect(out).not.toContain("nothing needs your attention");
    });

    it("soft-fails a single section (budgets 403) without breaking status", async () => {
      mockAllSuccess();
      const baseFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/gateway/v1/budgets")) {
          // A project key without gatewayBudgets:view gets a 403 — that must
          // degrade the budgets section, not the whole status command.
          return {
            ok: false,
            status: 403,
            statusText: "Forbidden",
            json: async () => ({ error: "Forbidden" }),
          };
        }
        return baseFetch(input as Parameters<typeof fetch>[0]);
      }) as unknown as typeof fetch;

      await statusCommand();

      const out = consoleLogSpy.mock.calls.flat().join("\n");
      // The failure is noted dimly, and the rest of status rendered fine —
      // but with a section down there is no green all-clear.
      expect(out).toContain("(could not check gateway budgets");
      expect(out).not.toContain("nothing needs your attention");
      expect(out).toContain("nothing flagged, but some checks did not run");
      expect(out).toContain("Resource Counts:");
    });

    it("machine output carries the attention document + per-section errors map", async () => {
      mockAllSuccess();
      mockPOST.mockResolvedValue({
        data: { traces: [], pagination: { totalHits: 3 } },
        error: undefined,
        response: { status: 200 },
      });
      const baseFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/gateway/v1/budgets")) {
          return {
            ok: false,
            status: 403,
            statusText: "Forbidden",
            json: async () => ({ error: "Forbidden" }),
          };
        }
        return baseFetch(input as Parameters<typeof fetch>[0]);
      }) as unknown as typeof fetch;

      await statusCommand({ output: "json" });

      const doc = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
      expect(doc.attention.erroredTraces24h).toBe(3);
      expect(doc.attention.runningExperiments).toEqual([]);
      // A failed section is null, with the reason in the errors map.
      expect(doc.attention.budgetsAtRisk).toBeNull();
      expect(typeof doc.attention.errors.budgetsAtRisk).toBe("string");
      expect(doc.attention.errors.budgetsAtRisk.length).toBeGreaterThan(0);
      expect(doc.attention.errors.erroredTraces24h).toBeUndefined();
      // The resource counts moved under `resources` but kept their shape.
      expect(doc.resources.evaluators).toEqual({ count: 2 });
    });
  });
});

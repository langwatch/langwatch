import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route's rejection logs used to carry the whole body and the whole span.
 * These tests hold the two halves of the replacement: the payload does not
 * reach the log or Sentry, and what replaces it is specific enough to tell us
 * whether our schema — rather than the sender — is the thing that is wrong.
 */

const logCalls: Array<{ level: string; fields: any; message: string }> = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
  const record = (level: string) => (fields: any, message?: string) => {
    logCalls.push({ level, fields, message: message ?? "" });
  };
  return {
    ...actual,
    // validationMeta stays real — it is the unit under test here.
    createLogger: () => ({
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    }),
  };
});

const mockIngestNormalizedSpan = vi.fn();
const mockCheckLimit = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: vi.fn(() => ({
    usage: { checkLimit: mockCheckLimit },
    traces: { collection: { ingestNormalizedSpan: mockIngestNormalizedSpan } },
    evaluations: { reportEvaluation: vi.fn() },
    planProvider: { getActivePlan: vi.fn() },
    usageLimits: { notifyPlanLimitReached: vi.fn() },
  })),
}));

const mockResolve = vi.fn();

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({ resolve: mockResolve, markUsed: vi.fn() })),
  },
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: vi.fn(() => ({
      token: "test-token",
      projectId: "project-123",
    })),
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

const mockCaptureException = vi.fn();
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  getCurrentScope: vi.fn(() => undefined),
}));

const { app: collectorApp } = await import("../collector");

const testApp = new Hono();
testApp.route("/", collectorApp);

const fakeProject = {
  id: "project-123",
  teamId: "team-1",
  team: { id: "team-1", organizationId: "org-1" },
};

const NOW = Date.now();

/** Distinctive enough that finding it anywhere in a log is unambiguous. */
const CUSTOMER_SECRET = "sk-live-CUSTOMER-PROMPT-DO-NOT-LOG";

function postCollector(body: unknown) {
  return testApp.request("http://localhost/api/collector", {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * The rejection record, insisted upon. Returning it optionally let a missing
 * record surface as "cannot read .issues of undefined" from whichever
 * assertion happened to run first, which names neither the test nor the cause.
 */
function rejectionLog() {
  const log = logCalls.find((c) => c.message.startsWith("invalid "));
  if (!log) {
    throw new Error(
      `no rejection was logged; saw: ${logCalls.map((c) => c.message).join(", ") || "nothing"}`,
    );
  }
  return log;
}

/** Everything we handed the log sink and Sentry, as one searchable string. */
function everythingLogged() {
  return JSON.stringify({ logCalls, sentry: mockCaptureException.mock.calls });
}

describe("POST /api/collector validation diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logCalls.length = 0;
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });
    mockCheckLimit.mockResolvedValue({ exceeded: false });
    mockIngestNormalizedSpan.mockResolvedValue({ status: "collected" });
  });

  describe("given a span that fails schema validation", () => {
    describe("when a field has the wrong type", () => {
      const badSpan = {
        type: "span",
        span_id: "span-1",
        trace_id: "trace-1",
        timestamps: { started_at: CUSTOMER_SECRET, finished_at: NOW },
      };

      it("answers 400", async () => {
        const res = await postCollector({
          trace_id: "trace-1",
          spans: [badSpan],
        });
        expect(res.status).toBe(400);
      });

      /** @scenario A validation failure is a client error, not a server error */
      it("logs the rejection as a client error, not a server error", async () => {
        await postCollector({ trace_id: "trace-1", spans: [badSpan] });
        expect(rejectionLog().level).toBe("warn");
      });

      /** @scenario A rejected span reports the failing path and rule */
      it("names the failing path", async () => {
        await postCollector({ trace_id: "trace-1", spans: [badSpan] });
        const paths = rejectionLog().fields.issues.map((i: any) => i.path);
        expect(paths.join(" ")).toContain("timestamps.started_at");
      });

      it("reports the rule that rejected it", async () => {
        await postCollector({ trace_id: "trace-1", spans: [badSpan] });
        const codes = rejectionLog().fields.issues.map((i: any) => i.code);
        expect(codes).toContain("invalid_type");
      });

      it("counts the issues", async () => {
        await postCollector({ trace_id: "trace-1", spans: [badSpan] });
        expect(rejectionLog().fields.issueCount).toBeGreaterThan(0);
      });

      /** @scenario Customer values never reach the log */
      it("keeps the offending value out of the log and out of Sentry", async () => {
        await postCollector({ trace_id: "trace-1", spans: [badSpan] });
        expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
      });

      it("still tells the sender what was wrong", async () => {
        const res = await postCollector({
          trace_id: "trace-1",
          spans: [badSpan],
        });
        expect((await res.json()).error).toMatch(/timestamps/);
      });
    });

    describe("when the span carries customer content in other fields", () => {
      it("does not log the rest of the span either", async () => {
        await postCollector({
          trace_id: "trace-1",
          spans: [
            {
              type: "span",
              span_id: "span-1",
              trace_id: "trace-1",
              input: { type: "text", value: CUSTOMER_SECRET },
              timestamps: { started_at: "not-a-number", finished_at: NOW },
            },
          ],
        });

        expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
      });
    });
  });

  describe("given a trace body that fails schema validation", () => {
    /** @scenario The request body is not logged */
    it("does not log the body", async () => {
      await postCollector({
        trace_id: { nested: CUSTOMER_SECRET },
        spans: [],
      });

      expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
    });

    it("logs the rejection at warning level", async () => {
      await postCollector({ trace_id: { nested: "bad" }, spans: [] });
      expect(rejectionLog().level).toBe("warn");
    });

    it("carries structured issues rather than a serialised error", async () => {
      await postCollector({ trace_id: { nested: "bad" }, spans: [] });
      expect(Array.isArray(rejectionLog().fields.issues)).toBe(true);
    });
  });

  describe("given a spans field that is not an array", () => {
    it("reports the type without the value", async () => {
      await postCollector({ trace_id: "trace-1", spans: CUSTOMER_SECRET });

      const log = logCalls.find((c) => c.message.includes("expecting array"));
      expect(log?.fields.receivedType).toBe("string");
      expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
    });
  });
});

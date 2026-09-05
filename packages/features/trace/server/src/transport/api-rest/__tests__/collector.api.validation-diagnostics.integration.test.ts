/**
 * What the collector says about a body it refuses.
 *
 * The rejection log used to carry the whole body and the whole span. These
 * suites hold the two halves of the replacement: the payload reaches neither
 * the log nor the error reporter, and what replaces it is specific enough to
 * tell us whether our schema — rather than the sender — is the thing that is
 * wrong.
 */
import { createAppRestSecurity, type RestApiServicePorts } from "@langwatch/api/rest";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logCalls: Array<{ level: string; fields: unknown; message: string }> = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  const record = (level: string) => (fields: unknown, message?: string) => {
    logCalls.push(
      typeof fields === "string"
        ? { level, fields: {}, message: fields }
        : { level, fields, message: message ?? "" },
    );
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

const { createCollectorRestApp } = await import("../collector.api");

const project = { id: "project-123", teamId: "team-1", organizationId: "org-1" };

const NOW = Date.now();

/** Distinctive enough that finding it anywhere in a log is unambiguous. */
const CUSTOMER_SECRET = "sk-live-CUSTOMER-PROMPT-DO-NOT-LOG";

const reportedErrors: Array<{ message: string; context: unknown }> = [];

function testSecurity() {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (_error, c) => c.json({ error: "Internal Server Error" }, 500),
    canonicalErrorHandler: (_error, c) => c.json({ error: "Internal Server Error" }, 500),
    authenticateProject: () => pass,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

const collector = createCollectorRestApp({
  security: testSecurity(),
  ports: {
    credential: async () => ({ ok: true, project, markUsed: () => undefined }),
    ingestSpan: async () => ({ status: "collected" }),
    deriveEvaluatorId: (name) => name,
    reportError: (error, context) => {
      reportedErrors.push({ message: error.message, context });
    },
  },
});

function postCollector(body: unknown) {
  return collector.hono.fetch(
    new Request("http://api.test/api/collector", {
      method: "POST",
      headers: { "X-Auth-Token": "test-token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * The rejection record, insisted upon. Returning it optionally let a missing
 * record surface as "cannot read .issues of undefined" from whichever
 * assertion happened to run first, which names neither the test nor the cause.
 */
function rejectionLog() {
  const log = logCalls.find((call) => call.message.startsWith("invalid "));
  if (!log) {
    throw new Error(
      `no rejection was logged; saw: ${logCalls.map((c) => c.message).join(", ") || "nothing"}`,
    );
  }
  return log as { level: string; fields: Record<string, any>; message: string };
}

/** Everything we handed the log sink and the error reporter, as one searchable string. */
function everythingLogged() {
  return JSON.stringify({ logCalls, reported: reportedErrors });
}

beforeEach(() => {
  logCalls.length = 0;
  reportedErrors.length = 0;
});

describe("given a span that fails schema validation", () => {
  const badSpan = {
    type: "span",
    span_id: "span-1",
    trace_id: "trace-1",
    timestamps: { started_at: CUSTOMER_SECRET, finished_at: NOW },
  };

  describe("when a field has the wrong type", () => {
    it("answers 400", async () => {
      const response = await postCollector({ trace_id: "trace-1", spans: [badSpan] });

      expect(response.status).toBe(400);
    });

    /** @scenario A validation failure is a client error, not a server error */
    it("logs the rejection as a client error, not a server error", async () => {
      await postCollector({ trace_id: "trace-1", spans: [badSpan] });

      expect(rejectionLog().level).toBe("warn");
    });

    /** @scenario A rejected span reports the failing path and rule */
    it("names the failing path and the rule that rejected it", async () => {
      await postCollector({ trace_id: "trace-1", spans: [badSpan] });

      const issues = rejectionLog().fields.issues as Array<{ path: string; code: string }>;
      expect(issues.map((issue) => issue.path).join(" ")).toContain("timestamps.started_at");
      expect(issues.map((issue) => issue.code)).toContain("invalid_type");
      expect(rejectionLog().fields.issueCount).toBeGreaterThan(0);
    });

    /** @scenario Customer values never reach the log */
    it("keeps the offending value out of the log and out of the error reporter", async () => {
      await postCollector({ trace_id: "trace-1", spans: [badSpan] });

      expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
    });

    it("still tells the sender what was wrong", async () => {
      const response = await postCollector({ trace_id: "trace-1", spans: [badSpan] });

      expect(((await response.json()) as { error: string }).error).toMatch(/timestamps/);
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
  describe("when the body is submitted", () => {
    /** @scenario The request body is not logged */
    it("does not log the body", async () => {
      await postCollector({ trace_id: { nested: CUSTOMER_SECRET }, spans: [] });

      expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
    });

    it("logs the rejection at warning level, with structured issues", async () => {
      await postCollector({ trace_id: { nested: "bad" }, spans: [] });

      expect(rejectionLog().level).toBe("warn");
      expect(Array.isArray(rejectionLog().fields.issues)).toBe(true);
    });
  });
});

describe("given a spans field that is not an array", () => {
  describe("when the body is submitted", () => {
    it("reports the type without the value", async () => {
      await postCollector({ trace_id: "trace-1", spans: CUSTOMER_SECRET });

      const log = logCalls.find((call) => call.message.includes("expecting array"));
      expect((log?.fields as Record<string, unknown> | undefined)?.receivedType).toBe("string");
      expect(everythingLogged()).not.toContain(CUSTOMER_SECRET);
    });
  });
});

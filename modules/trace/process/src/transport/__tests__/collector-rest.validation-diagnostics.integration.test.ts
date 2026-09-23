/**
 * @vitest-environment node
 * Verifies rejection payloads distinguish schema bugs from sender errors.
 * Builds the router directly: proves what it answers, not whether mounted.
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type * as observabilityModule from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logCalls: { level: string; fields: unknown; message: string }[] = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof observabilityModule>();
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

const { collectorRest } = await import("../collector.rest.ts");

const project = { id: "project-123", teamId: "team-1", organizationId: "org-1" };

const NOW = Date.now();

/** Distinctive enough that finding it anywhere in a log is unambiguous. */
const CUSTOMER_SECRET = "sk-live-CUSTOMER-PROMPT-DO-NOT-LOG";

const reportedErrors: { message: string; context: unknown }[] = [];

const runtime = createRestRuntime({
  identity: {
    authenticate: () => {
      throw new Error("The collector resolves its own credential.");
    },
  },
});

const collector = runtime.mount(collectorRest.router(), {
  app: () => ({
    collectorCredential: async () => ({ ok: true as const, project, markUsed: () => undefined }),
    collectorUsageLimit: async () => undefined,
    ingestSpan: async () => ({ status: "collected" }),
    reportEvaluation: async () => undefined,
    deriveEvaluatorId: (name: string) => name,
    collectorReportError: (error: Error, context: unknown) => {
      reportedErrors.push({ message: error.message, context });
    },
  }),
  credential: "public",
  onError: (error, context) => context.json({ error: String(error) }, 500),
});

function postCollector(body: unknown) {
  return collector.request("/api/collector", {
    method: "POST",
    headers: { "X-Auth-Token": "test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

      const issues = rejectionLog().fields.issues as { path: string; code: string }[];
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

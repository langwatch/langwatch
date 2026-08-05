import { describe, expect, it, vi } from "vitest";
import type { QueryRequest } from "./pipeline";
import {
  SPAN_ATTRIBUTES,
  type SpanPort,
  type TracerPort,
  trace,
} from "./tracing";

const recordingTracer = () => {
  const attributes: Record<string, string | number | boolean> = {};
  const errors: unknown[] = [];
  let ended = 0;

  const span: SpanPort = {
    setAttribute: (key, value) => {
      attributes[key] = value;
    },
    recordError: (error) => {
      errors.push(error);
    },
    end: () => {
      ended += 1;
    },
  };

  const tracer: TracerPort = { startSpan: () => span };
  return { tracer, attributes, errors, ended: () => ended };
};

const request: QueryRequest = {
  tenantId: "project_1",
  sql: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND Email = 'ops@example.com'",
  params: { tenantId: "project_1", secret: "sk-live-1234" },
  table: "stored_spans",
  kind: "read",
};

describe("trace", () => {
  describe("given a statement that succeeds", () => {
    it("records the tenant, table and operation", async () => {
      const { tracer, attributes } = recordingTracer();

      await trace({ tracer })(async () => ({ rows: [1, 2] }))(request);

      expect(attributes[SPAN_ATTRIBUTES.system]).toBe("clickhouse");
      expect(attributes[SPAN_ATTRIBUTES.tenant]).toBe("project_1");
      expect(attributes[SPAN_ATTRIBUTES.table]).toBe("stored_spans");
      expect(attributes[SPAN_ATTRIBUTES.operation]).toBe("read");
    });

    it("records how much came back", async () => {
      const { tracer, attributes } = recordingTracer();

      await trace({ tracer })(async () => ({
        rows: [1, 2],
        stats: { bytesRead: 4096 },
      }))(request);

      expect(attributes[SPAN_ATTRIBUTES.rows]).toBe(2);
      expect(attributes[SPAN_ATTRIBUTES.bytesRead]).toBe(4096);
    });

    it("never puts the statement or its parameters on the span", async () => {
      // Spans leave the process. Neither the SQL nor the bound values have
      // been through redaction, and a span backend is not a place customer
      // content is allowed to reach.
      const { tracer, attributes } = recordingTracer();

      await trace({ tracer })(async () => ({ rows: [] }))(request);

      const recorded = JSON.stringify(attributes);
      expect(recorded).not.toContain("SELECT");
      expect(recorded).not.toContain("ops@example.com");
      expect(recorded).not.toContain("sk-live-1234");
    });
  });

  describe("given a statement declared unscoped", () => {
    it("records the stated reason so exemptions can be audited", async () => {
      const { tracer, attributes } = recordingTracer();

      await trace({ tracer })(async () => ({ rows: [] }))({
        ...request,
        unscoped: { reason: "operational part-count check" },
      });

      expect(attributes[SPAN_ATTRIBUTES.unscopedReason]).toBe(
        "operational part-count check",
      );
    });
  });

  describe("given a statement that fails", () => {
    it("records the failure class and rethrows the original", async () => {
      const { tracer, errors } = recordingTracer();
      const failure = Object.assign(new Error("boom"), { code: "ECONNRESET" });

      await expect(
        trace({ tracer })(async () => {
          throw failure;
        })(request),
      ).rejects.toThrow("boom");

      expect(errors).toEqual([{ name: "Error", code: "ECONNRESET" }]);
    });

    it("never lets the failing statement reach the span", async () => {
      // ClickHouse embeds the statement in its own error message, so recording
      // the raw error would re-open the no-SQL rule on the failure path - the
      // path nobody inspects until an incident.
      const { tracer, errors } = recordingTracer();

      await expect(
        trace({ tracer })(async () => {
          throw new Error(
            "Code: 62. DB::Exception: Syntax error (in query: SELECT Email FROM t WHERE Email = 'ops@example.com')",
          );
        })(request),
      ).rejects.toThrow();

      const recorded = JSON.stringify(errors);
      expect(recorded).not.toContain("SELECT");
      expect(recorded).not.toContain("ops@example.com");
    });

    it("still ends the span", async () => {
      const { tracer, ended } = recordingTracer();

      await expect(
        trace({ tracer })(async () => {
          throw new Error("boom");
        })(request),
      ).rejects.toThrow();

      expect(ended()).toBe(1);
    });
  });

  describe("given a completion hook", () => {
    it("reports the duration on success", async () => {
      const { tracer } = recordingTracer();
      const onComplete = vi.fn();
      let clock = 1000;

      await trace({ tracer, onComplete, now: () => clock })(async () => {
        clock = 1075;
        return { rows: [] };
      })(request);

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: 75, rowCount: 0 }),
      );
    });

    it("reports the failure too, so error rates are countable", async () => {
      const { tracer } = recordingTracer();
      const onComplete = vi.fn();

      await expect(
        trace({ tracer, onComplete })(async () => {
          throw new Error("boom");
        })(request),
      ).rejects.toThrow();

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });
});

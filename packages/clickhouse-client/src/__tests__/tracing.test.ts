import { describe, expect, it, vi } from "vitest";
import type { QueryRequest } from "../query";
import { SPAN_ATTRIBUTES, type SpanPort, type TracerPort, QueryTracer } from "../tracing";

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
    describe("when the span is recorded", () => {
      it("records the tenant, table and operation", async () => {
        const { tracer, attributes } = recordingTracer();

        await new QueryTracer({ tracer }).trace({
          request,
          task: async () => ({ rows: [1, 2] }),
        });

        expect(attributes[SPAN_ATTRIBUTES.system]).toBe("clickhouse");
        expect(attributes[SPAN_ATTRIBUTES.tenant]).toBe("project_1");
        expect(attributes[SPAN_ATTRIBUTES.table]).toBe("stored_spans");
        expect(attributes[SPAN_ATTRIBUTES.operation]).toBe("read");
      });

      it("records how much came back", async () => {
        const { tracer, attributes } = recordingTracer();

        await new QueryTracer({ tracer }).trace({
          request,
          task: async () => ({
            rows: [1, 2],
            stats: { bytesRead: 4096 },
          }),
        });

        expect(attributes[SPAN_ATTRIBUTES.rows]).toBe(2);
        expect(attributes[SPAN_ATTRIBUTES.bytesRead]).toBe(4096);
      });

      it("never puts the statement or its parameters on the span", async () => {
        // Spans leave the process. Neither the SQL nor the bound values have
        // been through redaction, and a span backend is not a place customer
        // content is allowed to reach.
        const { tracer, attributes } = recordingTracer();

        await new QueryTracer({ tracer }).trace({
          request,
          task: async () => ({ rows: [] }),
        });

        const recorded = JSON.stringify(attributes);
        expect(recorded).not.toContain("SELECT");
        expect(recorded).not.toContain("ops@example.com");
        expect(recorded).not.toContain("sk-live-1234");
      });
    });
  });

  describe("given a statement declared unscoped", () => {
    describe("when the span is recorded", () => {
      it("records the stated reason so exemptions can be audited", async () => {
        const { tracer, attributes } = recordingTracer();

        await new QueryTracer({ tracer }).trace({
          request: {
            ...request,
            unscoped: { reason: "operational part-count check" },
          },
          task: async () => ({ rows: [] }),
        });

        expect(attributes[SPAN_ATTRIBUTES.unscopedReason]).toBe("operational part-count check");
      });
    });
  });

  describe("given a statement that fails", () => {
    describe("when the failure is recorded", () => {
      it("records the failure class and rethrows the original", async () => {
        const { tracer, errors } = recordingTracer();
        const failure = Object.assign(new Error("boom"), {
          code: "ECONNRESET",
        });

        await expect(
          new QueryTracer({ tracer }).trace({
            request,
            task: async () => {
              throw failure;
            },
          }),
        ).rejects.toThrow("boom");

        expect(errors).toEqual([{ name: "Error", code: "ECONNRESET" }]);
      });

      it("never lets the failing statement reach the span", async () => {
        // ClickHouse embeds the statement in its own error message, so
        // recording the raw error would re-open the no-SQL rule on the failure
        // path - the path nobody inspects until an incident.
        const { tracer, errors } = recordingTracer();

        await expect(
          new QueryTracer({ tracer }).trace({
            request,
            task: async () => {
              throw new Error(
                "Code: 62. DB::Exception: Syntax error (in query: SELECT Email FROM t WHERE Email = 'ops@example.com')",
              );
            },
          }),
        ).rejects.toThrow();

        const recorded = JSON.stringify(errors);
        expect(recorded).not.toContain("SELECT");
        expect(recorded).not.toContain("ops@example.com");
      });

      it("still ends the span", async () => {
        const { tracer, ended } = recordingTracer();

        await expect(
          new QueryTracer({ tracer }).trace({
            request,
            task: async () => {
              throw new Error("boom");
            },
          }),
        ).rejects.toThrow();

        expect(ended()).toBe(1);
      });
    });
  });

  describe("given a completion hook", () => {
    describe("when the statement completes", () => {
      it("reports the duration on success", async () => {
        const { tracer } = recordingTracer();
        const onComplete = vi.fn();
        let clock = 1000;

        await new QueryTracer({ tracer, onComplete, now: () => clock }).trace({
          request,
          task: async () => {
            clock = 1075;
            return { rows: [] };
          },
        });

        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({ durationMs: 75, rowCount: 0 }),
        );
      });

      it("reports the failure too, so error rates are countable", async () => {
        const { tracer } = recordingTracer();
        const onComplete = vi.fn();

        await expect(
          new QueryTracer({ tracer, onComplete }).trace({
            request,
            task: async () => {
              throw new Error("boom");
            },
          }),
        ).rejects.toThrow();

        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Error) }),
        );
      });
    });
  });

  describe("given host observability that is itself broken", () => {
    // Every one of these runs on the query's own path. A misconfigured span
    // exporter is a reporting problem, and it must not be able to fail a query
    // that ClickHouse answered perfectly well, nor replace a real ClickHouse
    // error with a telemetry one.
    const exploding = new Error("the span exporter is misconfigured");

    describe("when the tracer cannot start a span", () => {
      it("still returns the rows", async () => {
        const tracer: TracerPort = {
          startSpan: () => {
            throw exploding;
          },
        };

        await expect(
          new QueryTracer({ tracer }).trace({
            request,
            task: async () => ({ rows: [1] }),
          }),
        ).resolves.toEqual({ rows: [1] });
      });
    });

    describe("when the span throws while being written", () => {
      it("still returns the rows", async () => {
        const tracer: TracerPort = {
          startSpan: () => ({
            setAttribute: () => {
              throw exploding;
            },
            recordError: () => {
              throw exploding;
            },
            end: () => {
              throw exploding;
            },
          }),
        };

        await expect(
          new QueryTracer({ tracer }).trace({
            request,
            task: async () => ({ rows: [1] }),
          }),
        ).resolves.toEqual({ rows: [1] });
      });

      it("still reports the ClickHouse failure, not the span one", async () => {
        const tracer: TracerPort = {
          startSpan: () => ({
            setAttribute: () => undefined,
            recordError: () => {
              throw exploding;
            },
            end: () => undefined,
          }),
        };

        await expect(
          new QueryTracer({ tracer }).trace({
            request,
            task: async () => {
              throw new Error("Code: 241. Memory limit exceeded");
            },
          }),
        ).rejects.toThrow(/Memory limit exceeded/);
      });
    });

    describe("when the completion hook throws", () => {
      it("still returns the rows", async () => {
        const { tracer } = recordingTracer();

        await expect(
          new QueryTracer({
            tracer,
            onComplete: () => {
              throw exploding;
            },
          }).trace({ request, task: async () => ({ rows: [1] }) }),
        ).resolves.toEqual({ rows: [1] });
      });

      it("still reports the ClickHouse failure, not the counter one", async () => {
        const { tracer } = recordingTracer();

        await expect(
          new QueryTracer({
            tracer,
            onComplete: () => {
              throw exploding;
            },
          }).trace({
            request,
            task: async () => {
              throw new Error("Code: 241. Memory limit exceeded");
            },
          }),
        ).rejects.toThrow(/Memory limit exceeded/);
      });
    });
  });
});

/**
 * Security-core unit tests for the read-only trace query compiler (SPIKE #5670).
 *
 * These are Layer 1 (SQL-structure assertions, no DB) — fast regression guards.
 * The load-bearing evidence lives in compile.integration.test.ts, which executes
 * the emitted SQL against a real two-tenant ClickHouse and proves zero foreign
 * rows. Per CODING_STANDARDS, string assertions here are SUPPLEMENTARY to that
 * executed proof.
 *
 * @see specs/trace-query/read-only-query-surface.feature
 */

import { describe, expect, it } from "vitest";
import { compileTraceQuery } from "../compile";
import type { TraceQueryRequest } from "../schema";

const ACME = "acme-tenant-id";
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const now = 1_700_000_000_000;
const timeRange = { from: now - NINETY_DAYS, to: now };

function countTrace(overrides: Partial<TraceQueryRequest> = {}): TraceQueryRequest {
  return {
    aggregations: [{ op: "count" }],
    timeRange,
    ...overrides,
  };
}

/** Every allowlisted physical table the compiler may reference. */
const KNOWN_TABLES = ["trace_summaries", "stored_spans", "simulation_runs"];

/** Count how many allowlisted table references appear in the SQL. */
function tableRefCount(sql: string): number {
  let total = 0;
  for (const t of KNOWN_TABLES) {
    total += (sql.match(new RegExp(`\\b${t}\\b`, "g")) ?? []).length;
  }
  return total;
}

/** Count how many `TenantId = {tenantId:String}` predicates appear. */
function tenantPredicateCount(sql: string): number {
  return (sql.match(/TenantId\s*=\s*\{tenantId:String\}/g) ?? []).length;
}

describe("compileTraceQuery — security core", () => {
  describe("given SR-1: multi-tenant isolation (compiler-injected)", () => {
    describe("when compiling any query", () => {
      it("constrains the outer table with a compiler-injected tenant predicate", () => {
        const { sql, params } = compileTraceQuery({
          request: countTrace(),
          tenantId: ACME,
        });
        expect(sql).toMatch(/TenantId\s*=\s*\{tenantId:String\}/);
        expect(params.tenantId).toBe(ACME);
      });

      it("binds the tenant from context, never string-interpolated", () => {
        const { sql } = compileTraceQuery({
          request: countTrace(),
          tenantId: ACME,
        });
        // The literal tenant value must never appear inline in the SQL text.
        expect(sql).not.toContain(ACME);
      });
    });

    describe("when the request body smuggles a foreign tenant id", () => {
      it("ignores it — the bound tenant is the session's, and the foreign id appears nowhere", () => {
        const rogue = {
          ...countTrace(),
          // A field the type does not declare; a hostile caller might POST it.
          tenantId: "globex-victim",
          projectId: "globex-victim",
        } as unknown as TraceQueryRequest;

        const { sql, params } = compileTraceQuery({
          request: rogue,
          tenantId: ACME,
        });

        expect(params.tenantId).toBe(ACME);
        expect(sql).not.toContain("globex-victim");
        expect(Object.values(params)).not.toContain("globex-victim");
      });
    });

    describe("when the filter drills into span/event attributes (subqueries)", () => {
      it("scopes every generated table reference to the tenant", () => {
        const { sql } = compileTraceQuery({
          request: countTrace({ filter: "span.attribute.http.method:GET" }),
          tenantId: ACME,
        });
        // Outer table + the subquery table must each carry a tenant predicate.
        expect(tableRefCount(sql)).toBeGreaterThanOrEqual(2);
        expect(tenantPredicateCount(sql)).toBeGreaterThanOrEqual(tableRefCount(sql));
      });
    });

    describe("when hostile filter text tries to break out of the value slot", () => {
      it("binds the payload as a parameter, leaving the tenant predicate intact", () => {
        const injection = `x' OR TenantId = 'globex' OR '1'='1`;
        const { sql, params } = compileTraceQuery({
          request: countTrace({ filter: `"${injection}"` }),
          tenantId: ACME,
        });
        // 'globex' must never appear as a bare SQL token — only as a bound value.
        expect(sql).not.toContain("globex");
        expect(sql).toMatch(/TenantId\s*=\s*\{tenantId:String\}/);
        const smuggled = Object.values(params).some(
          (v) => typeof v === "string" && v.includes("globex"),
        );
        expect(smuggled).toBe(true); // proves it was captured as data, not code
      });
    });
  });

  describe("given SR-2 / SR-4 / SR-5: read-only by construction + allowlisting", () => {
    describe("when an unknown aggregation function is requested", () => {
      it("fails validation before any SQL is generated", () => {
        expect(() =>
          compileTraceQuery({
            request: countTrace({
              aggregations: [{ op: "DROP" as never, column: "cost" }],
            }),
            tenantId: ACME,
          }),
        ).toThrow();
      });
    });

    describe("when an unknown group-by column is requested", () => {
      it("rejects it — arbitrary identifiers cannot become SQL", () => {
        expect(() =>
          compileTraceQuery({
            request: countTrace({ groupBy: ["Models); DROP TABLE" as never] }),
            tenantId: ACME,
          }),
        ).toThrow();
      });
    });

    describe("when a ClickHouse table function name is used as an identifier", () => {
      it("is not in the allowlist and is rejected (no SSRF surface)", () => {
        for (const fn of ["url", "s3", "remote", "file", "executable"]) {
          expect(() =>
            compileTraceQuery({
              request: countTrace({ groupBy: [fn as never] }),
              tenantId: ACME,
            }),
          ).toThrow();
        }
      });
    });

    describe("when a metric aggregates an unknown column", () => {
      it("rejects it before SQL generation", () => {
        expect(() =>
          compileTraceQuery({
            request: countTrace({
              aggregations: [{ op: "avg", column: "system.tables" as never }],
            }),
            tenantId: ACME,
          }),
        ).toThrow();
      });
    });
  });

  describe("given SR-3: injection safety", () => {
    describe("when a query carries literal filter values", () => {
      it("passes every literal as a bound parameter, none interpolated", () => {
        const { sql, params } = compileTraceQuery({
          request: countTrace({ filter: "status:error" }),
          tenantId: ACME,
        });
        // The compiled fragment must reference params by name, not inline text.
        expect(sql).toMatch(/\{[a-zA-Z0-9_]+:[A-Za-z0-9()]+\}/);
        expect(Object.keys(params).length).toBeGreaterThan(0);
      });
    });
  });

  describe("given SR-6: resource governance", () => {
    describe("when no time range is supplied", () => {
      it("rejects the query rather than scanning all partitions", () => {
        expect(() =>
          compileTraceQuery({
            request: { aggregations: [{ op: "count" }] } as TraceQueryRequest,
            tenantId: ACME,
          }),
        ).toThrow();
      });
    });

    describe("when a time range is supplied", () => {
      it("always constrains the partition-key time column", () => {
        const { sql } = compileTraceQuery({
          request: countTrace(),
          tenantId: ACME,
        });
        expect(sql).toMatch(/OccurredAt\s*>=/);
        expect(sql).toMatch(/OccurredAt\s*<=/);
      });
    });

    describe("when the caller requests a huge or absent limit", () => {
      it("clamps to the configured row-cap ceiling", () => {
        const { sql } = compileTraceQuery({
          request: countTrace({ limit: 10_000_000 }),
          tenantId: ACME,
        });
        const limit = Number(/LIMIT\s+(\d+)/.exec(sql)?.[1]);
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(10_000);
      });

      it("emits a default LIMIT when none is given", () => {
        const { sql } = compileTraceQuery({
          request: countTrace(),
          tenantId: ACME,
        });
        expect(sql).toMatch(/LIMIT\s+\d+/);
      });
    });
  });

  describe("given a realistic aggregation (the demoable shape)", () => {
    describe("when computing p95 latency by model", () => {
      it("emits a grouped, tenant-scoped, bounded, parameterized query", () => {
        const { sql, params } = compileTraceQuery({
          request: {
            aggregations: [{ op: "p95", column: "durationMs", alias: "p95_latency" }],
            groupBy: ["model"],
            filter: "cost:>0.1",
            timeRange,
            limit: 100,
          },
          tenantId: ACME,
        });
        expect(sql).toMatch(/TenantId\s*=\s*\{tenantId:String\}/);
        expect(sql).toMatch(/GROUP BY/i);
        expect(sql).toMatch(/quantile/i);
        expect(sql).toMatch(/LIMIT\s+\d+/);
        expect(params.tenantId).toBe(ACME);
      });
    });
  });
});

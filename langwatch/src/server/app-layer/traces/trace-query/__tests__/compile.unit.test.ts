/**
 * Security-core unit tests for the read-only trace query compiler (SPIKE #5670).
 *
 * These are Layer 1 (SQL-structure assertions, no DB) — fast regression guards.
 * On the source branch (spike/5670-clickhouse-query-access) the load-bearing
 * evidence is compile.integration.test.ts, which executes the emitted SQL
 * against a real two-tenant ClickHouse and proves zero foreign rows, plus
 * specs/trace-query/read-only-query-surface.feature. Neither file was carried
 * over to this branch (no live 2-tenant ClickHouse available here) — on THIS
 * branch, these unit tests are the only test evidence for the compiler; treat
 * them as supplementary, not load-bearing, until the integration test lands.
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
      /** @scenario "The outer query carries a compiler-injected tenant predicate" */
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
      /** @scenario "A tenant id supplied in the request body is ignored" */
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
      /** @scenario "Every subquery, CTE, and UNION branch is independently tenant-scoped" */
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
      /** @scenario "Tenant scope cannot be commented-out or terminated by filter text" */
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
      /** @scenario "The query surface has no field that can carry a write" */
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
      /** @scenario "Only allowlisted tables, columns, and functions are queryable" */
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
      /** @scenario "Table-function tokens cannot enter the emitted SQL" */
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
      /** @scenario "Aggregation and column names are validated against an allowlist before SQL generation" */
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
      /** @scenario "Filter and aggregation values are passed as bound parameters" */
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
      /** @scenario "A query with no time range is rejected or auto-bounded" */
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
      /** @scenario "The emitted SQL carries a LIMIT ceiling" */
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

  describe("given two aggregations that share an op+column", () => {
    describe("when neither supplies an explicit alias", () => {
      it("emits distinct aliases so the SQL has no duplicate AS clause", () => {
        const { sql } = compileTraceQuery({
          request: countTrace({
            aggregations: [{ op: "count" }, { op: "count" }],
          }),
          tenantId: ACME,
        });
        const aliases = [...sql.matchAll(/AS\s+([a-zA-Z][a-zA-Z0-9_]*)/g)].map(
          (m) => m[1],
        );
        expect(aliases.length).toBe(2);
        expect(new Set(aliases).size).toBe(2); // distinct — no duplicate alias
      });
    });

    describe("when an explicit alias collides with a group-by dimension", () => {
      it("fails closed rather than emitting an ambiguous duplicate alias", () => {
        expect(() =>
          compileTraceQuery({
            request: countTrace({
              groupBy: ["model"],
              aggregations: [{ op: "count", alias: "model" }],
            }),
            tenantId: ACME,
          }),
        ).toThrow();
      });
    });
  });

  describe("given SR-6 correctness: ReplacingMergeTree dedup + deterministic paging", () => {
    describe("when compiling any aggregation", () => {
      it("keeps only the latest version per trace (IN-tuple dedup)", () => {
        const { sql } = compileTraceQuery({
          request: countTrace(),
          tenantId: ACME,
        });
        expect(sql).toMatch(/\(TenantId,\s*TraceId,\s*UpdatedAt\)\s*IN\s*\(/);
        expect(sql).toMatch(/max\(UpdatedAt\)/);
      });
    });

    describe("when the query groups by a dimension", () => {
      it("emits a deterministic ORDER BY so LIMIT never drops arbitrary groups", () => {
        const { sql } = compileTraceQuery({
          request: countTrace({ groupBy: ["model"] }),
          tenantId: ACME,
        });
        expect(sql).toMatch(/ORDER BY[\s\S]*LIMIT/i);
      });
    });
  });

  describe("given SR-6: an inverted time range", () => {
    describe("when from is greater than to", () => {
      it("is rejected rather than silently matching nothing", () => {
        expect(() =>
          compileTraceQuery({
            request: {
              aggregations: [{ op: "count" }],
              timeRange: { from: now, to: now - NINETY_DAYS },
            },
            tenantId: ACME,
          }),
        ).toThrow();
      });
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { QueryDriver, QueryRequest } from "./query";
import { ClickHouseQueryClient } from "./client";
import {
  checkTenantScope,
  TenantGuard,
  type TenantGuardOptions,
  TenantScopeError,
} from "./tenantGuard";

const TENANT = "project_abc";

const passthrough: QueryDriver["execute"] = async () => ({ rows: [] });

const request = (overrides: Partial<QueryRequest> = {}): QueryRequest => ({
  tenantId: TENANT,
  sql: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}",
  params: { tenantId: TENANT },
  ...overrides,
});

describe("checkTenantScope", () => {
  describe("given a properly scoped statement", () => {
    describe("when the statement is checked", () => {
      it.each([
        [
          "a bare predicate",
          "SELECT 1 FROM t WHERE TenantId = {tenantId:String}",
        ],
        [
          "an aliased predicate",
          "SELECT 1 FROM stored_spans AS t WHERE t.TenantId = {tenantId:String}",
        ],
        [
          "a predicate inside parentheses",
          "SELECT 1 FROM t WHERE (TenantId = {tenantId:String}) AND x = 1",
        ],
        [
          "an unusually named parameter",
          "SELECT 1 FROM t WHERE TenantId = {scope_id:String}",
        ],
      ])("accepts %s", (_label, sql) => {
        const param = /\{\s*(\w+)\s*:/.exec(sql)?.[1] as string;

        expect(
          checkTenantScope({
            sql,
            params: { [param]: TENANT },
            tenantId: TENANT,
          }),
        ).toBeNull();
      });
    });
  });

  describe("given a statement with no tenant predicate", () => {
    describe("when the statement is checked", () => {
      it("reports the omission", () => {
        // The dangerous case: TraceId is not unique across tenants, so this
        // returns another customer's spans and looks entirely healthy doing it.
        const violation = checkTenantScope({
          sql: "SELECT SpanId FROM stored_spans WHERE TraceId = {traceId:String}",
          params: { traceId: "trace_1" },
          tenantId: TENANT,
        });

        expect(violation).toEqual({ kind: "missing-predicate" });
      });
    });
  });

  describe("given a statement that inlines the tenant", () => {
    describe("when the inlined value is the correct tenant", () => {
      it.each([
        ["single quotes", "SELECT 1 FROM t WHERE TenantId = 'project_abc'"],
        ["double quotes", 'SELECT 1 FROM t WHERE TenantId = "project_abc"'],
      ])("still refuses %s", (_label, sql) => {
        expect(checkTenantScope({ sql, tenantId: TENANT })).toEqual({
          kind: "literal-predicate",
        });
      });
    });
  });

  describe("given a bound predicate whose parameter is absent", () => {
    describe("when the statement is checked", () => {
      it("reports the missing parameter", () => {
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE TenantId = {tenantId:String}",
            params: {},
            tenantId: TENANT,
          }),
        ).toEqual({ kind: "missing-param", param: "tenantId" });
      });
    });
  });

  describe("given a bound predicate for a different tenant", () => {
    describe("when the statement is checked", () => {
      it("refuses the mismatch rather than trusting the statement", () => {
        const violation = checkTenantScope({
          sql: "SELECT 1 FROM t WHERE TenantId = {tenantId:String}",
          params: { tenantId: "project_someone_else" },
          tenantId: TENANT,
        });

        expect(violation).toMatchObject({
          kind: "param-mismatch",
          expected: TENANT,
          actual: "project_someone_else",
        });
      });
    });
  });

  describe("given a commented-out predicate", () => {
    describe("when the statement is checked", () => {
      it.each([
        ["a line comment", "SELECT 1 FROM t -- WHERE TenantId = {t:String}"],
        ["a block comment", "/* TenantId = {t:String} */ SELECT 1 FROM t"],
      ])("refuses %s, which is the case the guard exists for", (_label, sql) => {
        expect(
          checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT }),
        ).toEqual({ kind: "missing-predicate" });
      });
    });
  });

  describe("given a disjunction that can weaken the predicate", () => {
    describe("when the OR sits at or above the predicate's depth", () => {
      it.each([
        [
          "a trailing OR",
          "SELECT 1 FROM t WHERE TenantId = {t:String} OR Status = 'x'",
        ],
        [
          "an OR outside the predicate's brackets",
          "SELECT 1 FROM t WHERE (TenantId = {t:String}) OR Status = 'x'",
        ],
        [
          "precedence confusion, which is how this reaches production",
          "SELECT 1 FROM t WHERE TenantId = {t:String} AND A = 1 OR B = 2",
        ],
        [
          "an OR in the outer query above a scoped subquery",
          "SELECT * FROM (SELECT Id FROM t WHERE TenantId = {t:String}) WHERE a = 1 OR b = 2",
        ],
      ])("refuses %s", (_label, sql) => {
        expect(
          checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT }),
        ).toEqual({ kind: "weakening-disjunction" });
      });
    });

    describe("when the OR is bracketed beneath the predicate", () => {
      it.each([
        [
          "a bracketed disjunction",
          "SELECT 1 FROM t WHERE TenantId = {t:String} AND (A = 1 OR B = 2)",
        ],
        [
          "an OR inside a string literal",
          "SELECT 1 FROM t WHERE TenantId = {t:String} AND Name = 'a OR b'",
        ],
        [
          "ORDER BY, which merely starts with the letters",
          "SELECT 1 FROM t WHERE TenantId = {t:String} ORDER BY OccurredAt",
        ],
      ])("accepts %s, because it cannot weaken the scoping", (_label, sql) => {
        expect(
          checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT }),
        ).toBeNull();
      });
    });
  });

  describe("given a statement the text check cannot see through", () => {
    describe("when the statement is checked", () => {
      // Accepted limits, kept executable so they stay documented rather than
      // becoming folklore. One match anywhere satisfies the whole statement,
      // and closing these needs a parser. See the module docblock.
      it.each([
        [
          "a UNION whose second arm is unscoped",
          "SELECT 1 FROM t WHERE TenantId = {t:String} UNION ALL SELECT 1 FROM t",
        ],
        [
          "a JOIN with only one side scoped",
          "SELECT 1 FROM a JOIN b ON a.Id = b.Id WHERE a.TenantId = {t:String}",
        ],
        [
          "a scoped subquery beneath an unscoped outer query",
          "SELECT * FROM (SELECT Id FROM t WHERE TenantId = {t:String}) UNION ALL SELECT Id FROM t",
        ],
      ])("still accepts %s", (_label, sql) => {
        expect(
          checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT }),
        ).toBeNull();
      });
    });
  });

  describe("given a statement built to make comment stripping backtrack", () => {
    describe("when the statement is checked", () => {
      it("still answers promptly", () => {
        // The previous `/\/\*[\s\S]*?\*\//` rescanned to the end of the input
        // from every unterminated `/*`, so this input took time quadratic in
        // its length. Once is enough to catch a regression: unbounded, this
        // does not finish.
        const hostile = `SELECT 1 FROM t WHERE TenantId = {t:String} ${"a/*".repeat(40_000)}`;
        const startedAt = performance.now();

        checkTenantScope({
          sql: hostile,
          params: { t: TENANT },
          tenantId: TENANT,
        });

        expect(performance.now() - startedAt).toBeLessThan(1_000);
      });
    });
  });

  describe("given a multi-tenant IN predicate", () => {
    describe("when the statement is checked", () => {
      it("does not accept it as scoping", () => {
        // `IN` spans tenants by construction. If that is genuinely wanted it
        // has to be declared unscoped, not smuggled past the check.
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE TenantId IN ({tenantIds:Array(String)})",
            params: { tenantIds: [TENANT] },
            tenantId: TENANT,
          }),
        ).toEqual({ kind: "missing-predicate" });
      });
    });
  });
});

/**
 * The guard as the client actually runs it: outermost, in front of a driver.
 * Asserting through the client rather than on `assert()` alone is what keeps
 * "refuses BEFORE the statement runs" a real claim — the driver spy is the
 * only thing that can witness it.
 */
function guardedBy(
  execute: QueryDriver["execute"],
  options: TenantGuardOptions = {},
) {
  const client = new ClickHouseQueryClient({
    driver: { execute },
    tenantGuard: new TenantGuard(options),
  });
  return (request: QueryRequest) => client.query(request);
}

describe("TenantGuard", () => {
  describe("given a scoped statement", () => {
    describe("when it is executed", () => {
      it("passes it through", async () => {
        const next = vi.fn(passthrough);

        await guardedBy(next)(request());

        expect(next).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given an unscoped statement", () => {
    describe("when it is executed", () => {
      it("refuses before the statement runs", async () => {
        const next = vi.fn(passthrough);
        const execute = guardedBy(next);

        await expect(
          execute(request({ sql: "SELECT 1 FROM t", params: {} })),
        ).rejects.toBeInstanceOf(TenantScopeError);
        expect(next).not.toHaveBeenCalled();
      });

      it("explains how to fix it", async () => {
        const execute = guardedBy(passthrough);

        await expect(
          execute(request({ sql: "SELECT 1 FROM t", params: {} })),
        ).rejects.toThrow(/TenantId = \{param:String\}/);
      });
    });
  });

  describe("given a statement declared unscoped", () => {
    describe("when it is executed", () => {
      it("allows it", async () => {
        const next = vi.fn(passthrough);
        const execute = guardedBy(next);

        await execute(
          request({
            sql: "SELECT count() FROM system.parts",
            params: {},
            unscoped: { reason: "operational part-count check" },
          }),
        );

        expect(next).toHaveBeenCalledTimes(1);
      });

      it("reports it so the exemptions can be audited", async () => {
        const onUnscoped = vi.fn();
        const execute = guardedBy(passthrough, { onUnscoped });
        const unscoped = request({
          sql: "SELECT count() FROM system.parts",
          params: {},
          unscoped: { reason: "operational part-count check" },
        });

        await execute(unscoped);

        expect(onUnscoped).toHaveBeenCalledWith(unscoped);
      });
    });
  });
});

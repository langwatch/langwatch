import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import {
  checkTenantScope,
  TenantGuard,
  type TenantGuardOptions,
  TenantScopeError,
} from "../tenantGuard.ts";

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
        ["a bare predicate", "SELECT 1 FROM t WHERE TenantId = {tenantId:String}"],
        [
          "an aliased predicate",
          "SELECT 1 FROM stored_spans AS t WHERE t.TenantId = {tenantId:String}",
        ],
        [
          "a predicate inside parentheses",
          "SELECT 1 FROM t WHERE (TenantId = {tenantId:String}) AND x = 1",
        ],
        ["an unusually named parameter", "SELECT 1 FROM t WHERE TenantId = {scope_id:String}"],
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
        expect(checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT })).toEqual({
          kind: "missing-predicate",
        });
      });
    });
  });

  describe("given a disjunction that can weaken the predicate", () => {
    describe("when the OR sits at or above the predicate's depth", () => {
      it.each([
        ["a trailing OR", "SELECT 1 FROM t WHERE TenantId = {t:String} OR Status = 'x'"],
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
        expect(checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT })).toEqual({
          kind: "weakening-disjunction",
        });
      });
    });

    describe("when the OR shares a bracket group with a tenant predicate or encloses one", () => {
      /** @scenario "An OR that can disjoin a tenant predicate away is refused" */
      it.each([
        [
          "an OR around a scoped IN subquery",
          "SELECT 1 FROM t WHERE Id IN (SELECT Id FROM u WHERE TenantId = {t:String}) OR 1 = 1",
        ],
        [
          "an OR leading the predicate",
          "SELECT 1 FROM t WHERE Status = 'x' OR TenantId = {t:String}",
        ],
        [
          "an OR beside the predicate inside its own bracket",
          "SELECT 1 FROM t WHERE (TenantId = {t:String} AND A = 1 OR B = 2)",
        ],
        [
          "an OR disjoining a later subquery's predicate",
          "SELECT 1 FROM t WHERE TenantId = {t:String} AND Id IN (SELECT Id FROM u WHERE TenantId = {t:String} OR 1 = 1)",
        ],
        [
          "an OR disjoining a scalar subquery's predicate",
          "SELECT (SELECT count() FROM u WHERE TenantId = {t:String} OR 1 = 1) AS n FROM t WHERE TenantId = {t:String}",
        ],
        [
          "an OR around a bracket that holds a later predicate",
          "SELECT 1 FROM t WHERE TenantId = {t:String} AND (Id IN (SELECT Id FROM u WHERE TenantId = {t:String}) OR 1 = 1)",
        ],
        [
          "an OR in an unscoped subquery beside a scoped one",
          "SELECT * FROM (SELECT Id FROM t WHERE TenantId = {t:String}) a JOIN (SELECT Id FROM u WHERE x = 1 OR y = 2) b USING Id",
        ],
        [
          "an OR beneath a predicate bound to another tenant",
          "SELECT if(Id IN (SELECT Id FROM u WHERE TenantId = {t:String}), 1, 0) AS f FROM v WHERE (TenantId = {other:String} AND (a = 1 OR b = 2))",
        ],
        [
          "an OR after an unbalanced bracket",
          "SELECT 1 FROM t WHERE TenantId = {t:String}) OR (1 = 1",
        ],
      ])("refuses %s", (_label, sql) => {
        expect(
          checkTenantScope({
            sql,
            params: { t: TENANT, other: "project_other" },
            tenantId: TENANT,
          }),
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
        expect(checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT })).toBeNull();
      });
    });

    describe("when the first predicate is deeper than the predicates the ORs sit beneath", () => {
      /** @scenario "An OR bracketed beneath a tenant predicate does not refuse a scoped statement" */
      it.each([
        [
          "date windows bracketed under the FROM subquery and the outer WHERE",
          "SELECT if(Id IN (SELECT Id FROM e WHERE TenantId = {t:String}), 1, 0) AS f FROM (SELECT * FROM s WHERE TenantId = {t:String} AND (a = 1 OR b = 2)) WHERE (TenantId = {t:String} AND (c = 1 OR d = 2))",
        ],
        [
          "a JOIN window bracketed under its own subquery's predicate",
          "SELECT if(Id IN (SELECT Id FROM e WHERE TenantId = {t:String}), 1, 0) AS f FROM (SELECT * FROM s WHERE TenantId = {t:String}) s JOIN (SELECT * FROM r WHERE TenantId = {t:String} AND (ScheduledAt IS NULL OR ScheduledAt >= now())) r ON s.Id = r.Id WHERE s.TenantId = {t:String}",
        ],
        [
          "a select-list OR after a scoped WITH, beneath the outer predicate",
          "WITH c AS (SELECT Id FROM s WHERE TenantId = {t:String}) SELECT (a != '' OR b != '') AS HasTokens FROM t WHERE TenantId = {t:String} AND Id IN (SELECT Id FROM c)",
        ],
      ])("accepts %s", (_label, sql) => {
        expect(checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT })).toBeNull();
      });
    });

    describe("when a declared tenant set scopes the statement", () => {
      const params = { a: TENANT, b: "project_b", c: "project_elsewhere" };
      const tenantIds = [TENANT, "project_b"];

      it("accepts an OR bracketed beneath a set predicate binding the declared tenants", () => {
        const sql =
          "SELECT if(Id IN (SELECT Id FROM e WHERE TenantId IN ({a:String}, {b:String})), 1, 0) FROM (SELECT * FROM s WHERE TenantId IN ({a:String}, {b:String}) AND (x = 1 OR y = 2))";
        expect(checkTenantScope({ sql, params, tenantId: TENANT, tenantIds })).toBeNull();
      });

      it("refuses an OR beneath a set predicate binding an undeclared tenant", () => {
        const sql =
          "SELECT if(Id IN (SELECT Id FROM e WHERE TenantId IN ({a:String}, {b:String})), 1, 0) FROM (SELECT * FROM s WHERE TenantId IN ({a:String}, {c:String}) AND (x = 1 OR y = 2))";
        expect(checkTenantScope({ sql, params, tenantId: TENANT, tenantIds })).toEqual({
          kind: "weakening-disjunction",
        });
      });
    });
  });

  describe("given a statement the text check cannot see through", () => {
    describe("when the statement is checked", () => {
      // Once accepted limits; each scope that reads a table now binds the tenant itself (GUARD-F2).
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
      ])("refuses %s", (_label, sql) => {
        expect(checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT })).toEqual({
          kind: "unbound-read",
        });
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
 * The guard as the client actually runs it: outermost, in front of a
 * driver. Asserting through the client, not `assert()` alone, keeps
 * "refuses BEFORE the statement runs" a real claim the driver spy can witness.
 */
function guardedBy(execute: QueryDriver["execute"], options: TenantGuardOptions = {}) {
  const client = new ClickHouseQueryClient({
    driver: { execute, insert: async () => {}, command: async () => {} },
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

        await expect(execute(request({ sql: "SELECT 1 FROM t", params: {} }))).rejects.toThrow(
          /TenantId = \{param:String\}/,
        );
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

    describe("when the audit hook throws", () => {
      it("still allows the statement the guard just approved", async () => {
        // `onUnscoped` is host code — an audit log, a counter — and it runs on
        // the branch where the guard has already decided to allow. Unguarded,
        // a broken audit sink turns every declared-unscoped statement into a
        // refusal, which is a reporting hook deciding policy.
        const next = vi.fn(passthrough);
        const execute = guardedBy(next, {
          onUnscoped: () => {
            throw new Error("audit sink is down");
          },
        });

        await execute(
          request({
            sql: "SELECT count() FROM system.parts",
            params: {},
            unscoped: { reason: "operational part-count check" },
          }),
        );

        expect(next).toHaveBeenCalledTimes(1);
      });
    });
  });
});

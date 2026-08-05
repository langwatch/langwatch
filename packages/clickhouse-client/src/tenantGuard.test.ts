import { describe, expect, it, vi } from "vitest";
import type { QueryExecutor, QueryRequest } from "./pipeline";
import { checkTenantScope, TenantScopeError, tenantGuard } from "./tenantGuard";

const TENANT = "project_abc";

const passthrough: QueryExecutor = async () => ({ rows: [] });

const request = (overrides: Partial<QueryRequest> = {}): QueryRequest => ({
  tenantId: TENANT,
  sql: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}",
  params: { tenantId: TENANT },
  ...overrides,
});

describe("checkTenantScope", () => {
  describe("given a properly scoped statement", () => {
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

  describe("given a statement with no tenant predicate", () => {
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

  describe("given a statement that inlines the tenant", () => {
    it.each([
      ["single quotes", "SELECT 1 FROM t WHERE TenantId = 'project_abc'"],
      ["double quotes", 'SELECT 1 FROM t WHERE TenantId = "project_abc"'],
    ])("refuses %s even when the value is correct", (_label, sql) => {
      expect(checkTenantScope({ sql, tenantId: TENANT })).toEqual({
        kind: "literal-predicate",
      });
    });
  });

  describe("given a bound predicate whose parameter is absent", () => {
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

  describe("given a bound predicate for a different tenant", () => {
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

  describe("given a commented-out predicate", () => {
    it.each([
      ["a line comment", "SELECT 1 FROM t -- WHERE TenantId = {t:String}"],
      ["a block comment", "/* TenantId = {t:String} */ SELECT 1 FROM t"],
    ])("refuses %s, which is the case the guard exists for", (_label, sql) => {
      expect(
        checkTenantScope({ sql, params: { t: TENANT }, tenantId: TENANT }),
      ).toEqual({ kind: "missing-predicate" });
    });
  });

  describe("given a statement the text check cannot see through", () => {
    // Accepted limits, kept executable so they stay documented rather than
    // becoming folklore. One match anywhere satisfies the whole statement, and
    // closing these needs a parser. See the module docblock.
    it.each([
      [
        "a disjunction that returns every tenant",
        "SELECT 1 FROM t WHERE TenantId = {t:String} OR Status = 'x'",
      ],
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

  describe("given a multi-tenant IN predicate", () => {
    it("does not accept it as scoping", () => {
      // `IN` spans tenants by construction. If that is genuinely wanted it has
      // to be declared unscoped, not smuggled past the check.
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

describe("tenantGuard", () => {
  describe("given a scoped statement", () => {
    it("passes it through", async () => {
      const next = vi.fn(passthrough);

      await tenantGuard()(next)(request());

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an unscoped statement", () => {
    it("refuses before the statement runs", async () => {
      const next = vi.fn(passthrough);
      const execute = tenantGuard()(next);

      await expect(
        execute(request({ sql: "SELECT 1 FROM t", params: {} })),
      ).rejects.toBeInstanceOf(TenantScopeError);
      expect(next).not.toHaveBeenCalled();
    });

    it("explains how to fix it", async () => {
      const execute = tenantGuard()(passthrough);

      await expect(
        execute(request({ sql: "SELECT 1 FROM t", params: {} })),
      ).rejects.toThrow(/TenantId = \{param:String\}/);
    });
  });

  describe("given a statement declared unscoped", () => {
    it("allows it", async () => {
      const next = vi.fn(passthrough);
      const execute = tenantGuard()(next);

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
      const execute = tenantGuard({ onUnscoped })(passthrough);
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

import { afterAll, describe, expect, it } from "vitest";

import { clickhouseTenantIdRule } from "../../src/rules/clickhouse-tenant-id.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const REPOSITORY = "modules/agent/process/src/repositories/clickhouse/agent-runs.repository.ts";
const ENTERPRISE =
  "enterprise/modules/billing/process/src/repositories/clickhouse/billing-runs.repository.ts";

function report(code, filename = REPOSITORY) {
  return runRule(clickhouseTenantIdRule, { code, cwd: workspace.cwd, filename });
}

function tablesOf(found) {
  return found.map((finding) => [finding.line, finding.data.table]);
}

describe("given a ClickHouse repository in a module's process half", () => {
  describe("when a query reads a table with no tenant predicate", () => {
    /** @scenario "A query that reads a table without a TenantId predicate is reported" */
    it("reports missingTenantPredicate on the query's line, naming the table", () => {
      const found = report(
        [
          "export async function findRuns(client) {",
          "  return client.query({",
          "    query: `",
          "      SELECT RunId FROM agent_runs",
          "      WHERE RunId = {runId:String}",
          "    `,",
          "  });",
          "}",
        ].join("\n"),
      );

      expect(tablesOf(found)).toEqual([[3, "agent_runs"]]);
      expect(found[0].message).toBe(
        "This ClickHouse query reads `agent_runs` without a `TenantId` predicate in that table's own WHERE, so it can return another tenant's rows." +
          " Add `TenantId = {tenantId:String}` (or `TenantId IN {tenantIds:Array(String)}`) to the WHERE that filters `agent_runs`.",
      );
    });
  });

  describe("when the query filters TenantId on a bound parameter", () => {
    /** @scenario "A query that filters TenantId on a bound parameter is left alone" */
    it("reports nothing for any of the tenant columns and shapes the client accepts", () => {
      const found = report(
        [
          "const a = `SELECT 1 FROM agent_runs WHERE TenantId = {tenantId:String}`;",
          "const b = `SELECT 1 FROM agent_runs t WHERE t.TenantId IN {tenantIds:Array(String)}`;",
          "const c = `SELECT 1 FROM stored_objects WHERE project_id = {projectId:String}`;",
          "const d = `SELECT 1 FROM agent_runs WHERE TenantId IN (${placeholders})`;",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the outer query is scoped but a subquery is not", () => {
    /** @scenario "A subquery without its own tenant predicate is reported" */
    it("reports the subquery's table only", () => {
      const found = report(
        [
          "const sql = `",
          "  SELECT * FROM agent_runs",
          "  WHERE TenantId = {tenantId:String}",
          "    AND TraceId IN (SELECT TraceId FROM agent_spans WHERE Name = {name:String})",
          "`;",
        ].join("\n"),
      );

      expect(tablesOf(found)).toEqual([[1, "agent_spans"]]);
    });
  });

  describe("when only the subquery names the tenant", () => {
    it("reports the outer table, since a subquery's predicate does not scope its parent", () => {
      const found = report(
        [
          "const sql = `",
          "  SELECT * FROM agent_runs",
          "  WHERE RunId IN (SELECT RunId FROM agent_spans WHERE TenantId = {tenantId:String})",
          "`;",
        ].join("\n"),
      );

      expect(tablesOf(found)).toEqual([[1, "agent_runs"]]);
    });
  });

  describe("when the tenant predicate sits inside the WHERE's brackets", () => {
    it("reports nothing, because a bracket is not a subquery", () => {
      const found = report(
        "const sql = `SELECT * FROM agent_runs WHERE (TenantId = {tenantId:String} AND (a = 1 OR b = 2))`;",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the statement declares unscoped with a reason", () => {
    /** @scenario "A statement declared unscoped is left alone" */
    it("reports nothing for an inline declaration or one made by a method of the same class", () => {
      const found = report(
        [
          "class AgentRuns {",
          "  sweep(client) {",
          "    return client.query({",
          "      query: `SELECT TenantId FROM agent_runs WHERE Stalled = 1`,",
          '      unscoped: { reason: "The stalled-run sweep spans every tenant." },',
          "    });",
          "  }",
          "  total(client) {",
          "    return this.#organizationQuery({",
          "      sql: `SELECT count() FROM agent_ledger WHERE OrganizationId = {organizationId:String}`,",
          "    });",
          "  }",
          "  #organizationQuery(input) {",
          '    return this.client.query({ query: input.sql, unscoped: { reason: "Organization ledger." } });',
          "  }",
          "}",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the WHERE clause is delegated to a builder", () => {
    /** @scenario "A WHERE clause handed over by a builder is left alone" */
    it("reports nothing for `WHERE ${where}` or a `${buildXWhere()}` placeholder", () => {
      const found = report(
        [
          "function build(where) {",
          "  const a = `SELECT * FROM agent_runs WHERE ${where} AND x = 1`;",
          "  const b = `SELECT * FROM agent_runs ${buildRunItemsWhere()} GROUP BY RunId`;",
          "  return [a, b];",
          "}",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the predicate lives in a string constant the query interpolates", () => {
    it("reports nothing, because the constant is read into the query text", () => {
      const found = report(
        [
          'const SCOPE = "TenantId = {tenantId:String}";',
          "const sql = `SELECT * FROM agent_runs WHERE ${SCOPE} AND x = 1`;",
          "const joined =",
          '  "SELECT * FROM agent_runs " +',
          '  "WHERE TenantId = {tenantId:String}";',
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a concatenated query never names the tenant", () => {
    it("reports once, on the first line of the concatenation", () => {
      const found = report(
        [
          "const sql =",
          '  "SELECT * FROM agent_runs " +',
          '  "WHERE RunId = {runId:String}";',
        ].join("\n"),
      );

      expect(tablesOf(found)).toEqual([[2, "agent_runs"]]);
    });
  });

  describe("when the query reads a system table or a common table expression", () => {
    /** @scenario "System tables and common table expressions are not tenant tables" */
    it("reports nothing for system tables, CTEs, trim operands or table functions", () => {
      const found = report(
        [
          "const a = `SELECT * FROM system.mutations WHERE is_done = 0`;",
          "const b = `WITH runs AS (SELECT * FROM agent_runs WHERE TenantId = {tenantId:String}) SELECT * FROM runs`;",
          "const c = `(SELECT total FROM simple_metrics_current)`;",
          "const d = `simple_metrics_current AS (SELECT count() AS total FROM agent_runs WHERE TenantId = {tenantId:String})`;",
          'const e = `WITH ${cte("per_run_current")} SELECT * FROM per_run_current`;',
          "const f = `SELECT trim(BOTH '\"' FROM label) FROM agent_runs WHERE TenantId = {tenantId:String}`;",
          "const g = `SELECT number FROM numbers(10)`;",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a subquery correlates its tenant with the scoped outer query", () => {
    it("reports nothing for `s.TenantId = t.TenantId` inside the subquery", () => {
      const found = report(
        "const sql = `SELECT * FROM agent_runs t WHERE t.TenantId = {tenantId:String} AND EXISTS (SELECT 1 FROM agent_spans s WHERE s.TenantId = t.TenantId)`;",
      );

      expect(found).toEqual([]);
    });

    it("reports an outer query that relies on a tenant tuple alone", () => {
      const found = report(
        "const sql = `SELECT * FROM agent_runs t PREWHERE (t.TenantId, t.RunId) IN (SELECT TenantId, RunId FROM agent_runs WHERE TenantId = {tenantId:String})`;",
      );

      expect(tablesOf(found)).toEqual([[1, "agent_runs"]]);
    });

    it("reports a top-level correlation, which scopes nothing", () => {
      const found = report(
        "const sql = `SELECT * FROM agent_runs s WHERE s.TenantId = t.TenantId`;",
      );

      expect(tablesOf(found)).toEqual([[1, "agent_runs"]]);
    });
  });

  describe("when a mutation rewrites rows", () => {
    it("reports an ALTER TABLE … DELETE with no tenant predicate", () => {
      const found = report(
        "const sql = `ALTER TABLE agent_runs DELETE WHERE RunId = {runId:String}`;",
        ENTERPRISE,
      );

      expect(tablesOf(found)).toEqual([[1, "agent_runs"]]);
    });
  });

  describe("when the organization-scoped ledger is read by organization", () => {
    it("accepts OrganizationId on metric_usage_estimates only", () => {
      const found = report(
        [
          "const a = `SELECT * FROM metric_usage_estimates WHERE OrganizationId = {organizationId:String}`;",
          "const b = `SELECT * FROM agent_runs WHERE OrganizationId = {organizationId:String}`;",
        ].join("\n"),
      );

      expect(tablesOf(found)).toEqual([[2, "agent_runs"]]);
    });
  });
});

describe("given a file outside a ClickHouse repository", () => {
  describe("when it holds a query with no tenant predicate", () => {
    /** @scenario "Files outside ClickHouse repositories are not checked" */
    it("reports nothing in a service or in a repository test", () => {
      const code = "const sql = `SELECT * FROM agent_runs`;";

      expect(report(code, "modules/agent/process/src/services/agent.service.ts")).toEqual([]);
      expect(
        report(
          code,
          "modules/agent/process/src/repositories/clickhouse/__tests__/agent-runs.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });
});

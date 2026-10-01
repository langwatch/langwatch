import { afterAll, describe, expect, it } from "vitest";

import { clickhouseNoVersionOrderLimitRule } from "../../src/rules/clickhouse-no-version-order-limit.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const REPOSITORY = "modules/agent/process/src/repositories/clickhouse/agent-spans.repository.ts";

function report(code, filename = REPOSITORY) {
  return runRule(clickhouseNoVersionOrderLimitRule, { code, cwd: workspace.cwd, filename });
}

describe("given a ClickHouse repository in a module's process half", () => {
  describe("when a query reads heavy columns and orders by its version to take one row", () => {
    /** @scenario "Picking the latest version of heavy rows by sorting is reported" */
    it("reports versionOrderLimit on the query's line, naming the version column", () => {
      const found = report(
        [
          'const COLUMNS = "SpanId, SpanAttributes";',
          "const sql = `",
          "  SELECT ${COLUMNS} FROM agent_spans",
          "  WHERE TenantId = {tenantId:String} AND SpanId = {spanId:String}",
          "  ORDER BY UpdatedAt DESC",
          "  LIMIT 1",
          "`;",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.column])).toEqual([
        [2, "UpdatedAt"],
      ]);
      expect(found[0].message).toBe(
        "This ClickHouse query reads heavy columns and picks the latest version with `ORDER BY UpdatedAt DESC LIMIT 1`, which loads every unmerged version before discarding them." +
          " Select the latest version with an IN-tuple dedup: key columns and `max(UpdatedAt)` in an inner GROUP BY, heavy columns only in the outer SELECT.",
      );
    });
  });

  describe("when the sorted query reads only light columns", () => {
    /** @scenario "Sorting light rows by version is left alone" */
    it("reports nothing", () => {
      const found = report(
        "const sql = `SELECT SpanId FROM agent_spans WHERE TenantId = {tenantId:String} ORDER BY Version DESC LIMIT 1`;",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when heavy columns are deduplicated with an IN tuple", () => {
    it("reports nothing", () => {
      const found = report(
        [
          "const sql = `SELECT SpanAttributes FROM agent_spans t",
          "  WHERE t.TenantId = {tenantId:String}",
          "    AND (t.TenantId, t.SpanId, t.UpdatedAt) IN (",
          "      SELECT TenantId, SpanId, max(UpdatedAt) FROM agent_spans",
          "      WHERE TenantId = {tenantId:String} GROUP BY TenantId, SpanId)`;",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a file outside a ClickHouse repository", () => {
  describe("when it spells the anti-pattern", () => {
    it("reports nothing", () => {
      const found = report(
        "const sql = `SELECT Details FROM t ORDER BY UpdatedAt DESC LIMIT 1`;",
        "modules/agent/process/src/services/agent.service.ts",
      );

      expect(found).toEqual([]);
    });
  });
});

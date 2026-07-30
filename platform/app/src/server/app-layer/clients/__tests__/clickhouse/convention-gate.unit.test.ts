import { describe, expect, it } from "vitest";
import {
  CATALOGUE_TABLES,
  SCHEMA_CATALOGUE,
} from "~/server/clickhouse/schema-catalogue";
import {
  detectColdScan,
  findConventionViolations,
} from "../../clickhouse/convention-gate";

describe("the ClickHouse convention gate", () => {
  /** @scenario "a read of a partitioned table with no filter on its partition column is counted" */
  it("flags a stored_spans query with no time predicate", () => {
    const query = `
      SELECT SpanId, TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
    `;
    expect(detectColdScan(query)).toBe("stored_spans");
  });

  it("clears the flag when the time column is in a WHERE comparison", () => {
    const query = `
      SELECT SpanId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND TraceId = {traceId:String}
        AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})
    `;
    expect(detectColdScan(query)).toBeNull();
  });

  it("clears the flag for a reversed comparison ({from} <= StartTime)", () => {
    const query = `
      SELECT SpanId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND fromUnixTimestamp64Milli({fromMs:Int64}) <= StartTime
    `;
    expect(detectColdScan(query)).toBeNull();
  });

  it("clears the flag for BETWEEN and IN predicates", () => {
    expect(
      detectColdScan(
        "SELECT 1 FROM stored_spans WHERE StartTime BETWEEN a AND b",
      ),
    ).toBeNull();
    expect(
      detectColdScan("SELECT 1 FROM stored_spans WHERE StartTime IN (1, 2, 3)"),
    ).toBeNull();
  });

  /** @scenario "mentioning the partition column without comparing it does not count as filtering on it" */
  it("STILL flags when the time column is only in the projection / ORDER BY (the real prod case)", () => {
    // Verified on prod: this shape scans 252/252 partitions because StartTime in
    // SELECT/ORDER BY does not enable partition pruning - only a WHERE does.
    const query = `
      SELECT SpanId, toUnixTimestamp64Milli(StartTime) AS StartTimeMs
      FROM stored_spans
      WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
      ORDER BY StartTimeMs ASC
    `;
    expect(detectColdScan(query)).toBe("stored_spans");
  });

  it("is case-insensitive on table and column names", () => {
    expect(
      detectColdScan("select spanid from STORED_SPANS where tenantid = 'x'"),
    ).toBe("stored_spans");
    expect(
      detectColdScan(
        "select spanid from STORED_SPANS where starttime > now() - 1",
      ),
    ).toBeNull();
  });

  it("does not match a table whose name is a superstring (word boundary)", () => {
    const query =
      "SELECT * FROM stored_spans_archive WHERE TenantId = {tenantId:String}";
    expect(detectColdScan(query)).toBeNull();
  });

  it("ignores non-SELECT statements", () => {
    expect(
      detectColdScan("INSERT INTO stored_spans (SpanId) VALUES ('x')"),
    ).toBeNull();
    expect(
      detectColdScan("ALTER TABLE stored_spans DELETE WHERE TraceId = 'x'"),
    ).toBeNull();
  });

  it("handles WITH (CTE) queries", () => {
    const query = `
      WITH ids AS (SELECT TraceId FROM other_table)
      SELECT SpanId FROM stored_spans WHERE TraceId IN (SELECT TraceId FROM ids)
    `;
    expect(detectColdScan(query)).toBe("stored_spans");
  });

  it("does not let a commented-out time predicate clear the flag", () => {
    const lineComment = `
      SELECT SpanId FROM stored_spans
      WHERE TenantId = {tenantId:String}
      -- AND StartTime >= something
    `;
    expect(detectColdScan(lineComment)).toBe("stored_spans");

    const blockComment = `
      SELECT SpanId FROM stored_spans /* StartTime >= x */
      WHERE TenantId = {tenantId:String}
    `;
    expect(detectColdScan(blockComment)).toBe("stored_spans");
  });

  it("returns null for tables that are not time-partitioned", () => {
    expect(
      detectColdScan("SELECT * FROM trace_checks WHERE project_id = 'x'"),
    ).toBeNull();
  });

  it("returns null for empty or non-string input", () => {
    expect(detectColdScan("")).toBeNull();
    expect(detectColdScan(undefined as unknown as string)).toBeNull();
    expect(detectColdScan(null as unknown as string)).toBeNull();
  });

  /** @scenario "every partitioned table is visible to the runtime check" */
  it("flags every catalogued table when its partition predicate is missing", () => {
    // The check this replaces iterated its OWN map and asserted the entries
    // already in it, which can only ever pass. This iterates the catalogue,
    // which the drift test pins to the migrations — so a table added to the
    // DDL and not to the catalogue fails there, and one added to the catalogue
    // and not understood here fails on this line.
    for (const table of CATALOGUE_TABLES) {
      const { partitionColumn, tenantColumns } = SCHEMA_CATALOGUE[table];
      const scope = `${tenantColumns[0]} = 'x'`;

      const cold = `SELECT 1 FROM ${table} WHERE ${scope}`;
      expect(detectColdScan(cold), `${table} unwatched`).toBe(table);

      const warm = `SELECT 1 FROM ${table} WHERE ${scope} AND ${partitionColumn} > 0`;
      expect(detectColdScan(warm), `${table} false positive`).toBeNull();
    }
  });

  it("flags the exact query captured live from prod (tree columns, no time predicate)", () => {
    const prodQuery = `SELECT SpanId, TraceId, TenantId, ParentSpanId, ParentTraceId, ParentIsRemote, Sampled, toUnixTimestamp64Milli(StartTime) AS StartTimeMs, DurationMs, SpanName FROM stored_spans WHERE (TenantId = 'project_x') AND (TraceId = 'abc') AND ((TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE (TenantId = 'project_x') AND (TraceId = 'abc') GROUP BY TenantId, TraceId, SpanId)) ORDER BY StartTimeMs ASC LIMIT 512`;
    expect(detectColdScan(prodQuery)).toBe("stored_spans");
  });

  describe("when the read is not scoped to a tenant", () => {
    /** @scenario "a read with no tenant predicate is counted" */
    it("reports an unscoped read", () => {
      const query =
        "SELECT SpanId FROM stored_spans WHERE StartTime > 0 AND TraceId = 'a'";

      expect(findConventionViolations(query)).toContainEqual({
        table: "stored_spans",
        rule: "tenant_predicate",
      });
    });

    /** @scenario "a table whose tenant column is not the usual one is checked against its own column" */
    it("checks a project-scoped table against project_id, not TenantId", () => {
      // stored_objects is the one table scoped by project_id. A gate that
      // looked for TenantId everywhere would flag every correct read of it.
      const query =
        "SELECT id FROM stored_objects WHERE project_id = 'p' AND created_at > 0";

      expect(findConventionViolations(query)).toEqual([]);
    });

    it("accepts an org-scoped read of a table whose sort key leads on the org", () => {
      // billable_events sorts (OrganizationId, TenantId, …), so an org-scoped
      // read prunes properly. The audit found this sound but undocumented,
      // which is how it stayed a suspected bug.
      const query =
        "SELECT 1 FROM billable_events WHERE OrganizationId = 'o' AND EventTimestamp > 0";

      expect(findConventionViolations(query)).toEqual([]);
    });
  });

  describe("when a violation is registered as deliberate", () => {
    // The cross-instance owner lookup cannot scope to the project it exists to
    // discover; the caller re-scopes before reading anything else.
    const crossInstanceLookup =
      "SELECT project_id FROM stored_objects WHERE id = {id:String} LIMIT 1";

    /** @scenario "a registered exception suppresses the rule it was registered for" */
    it("suppresses the rule the exception was registered for", () => {
      expect(findConventionViolations(crossInstanceLookup)).not.toContainEqual({
        table: "stored_objects",
        rule: "tenant_predicate",
      });
    });

    /** @scenario "a registered exception does not suppress the rules it was not registered for" */
    it("leaves the rules the exception was not registered for in force", () => {
      // Registered against tenant_predicate only, so the missing partition
      // filter still counts. An exemption keyed to the whole table would have
      // blinded the gate to both.
      expect(findConventionViolations(crossInstanceLookup)).toContainEqual({
        table: "stored_objects",
        rule: "partition_predicate",
      });
    });

    it("stops applying when the query it excuses is rewritten", () => {
      // The exemption matches the query's own text, so a rewrite re-arms the
      // rule rather than inheriting an amnesty.
      const rewritten =
        "SELECT project_id, size_bytes FROM stored_objects WHERE object_key = {key:String}";

      expect(findConventionViolations(rewritten)).toContainEqual({
        table: "stored_objects",
        rule: "tenant_predicate",
      });
    });
  });

  describe("when the statement is not a read", () => {
    /** @scenario "a write is not judged by the read rules" */
    it("judges no rule against a write", () => {
      expect(
        findConventionViolations(
          "INSERT INTO stored_spans (SpanId) VALUES ('x')",
        ),
      ).toEqual([]);
      expect(
        findConventionViolations(
          "ALTER TABLE stored_spans DELETE WHERE TraceId = 'x'",
        ),
      ).toEqual([]);
    });
  });

  describe("when one table name is a suffix of another", () => {
    it("attributes the read to the table actually named", () => {
      // `log_records` is a suffix of `stored_log_records`. A substring match
      // would check stored_log_records against log_records' columns.
      const query =
        "SELECT 1 FROM stored_log_records WHERE TenantId = 'x' AND TimeUnixMs > 0";

      expect(findConventionViolations(query)).toEqual([]);
    });
  });
});

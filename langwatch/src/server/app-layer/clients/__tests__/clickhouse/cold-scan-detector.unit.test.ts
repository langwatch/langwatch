import { describe, it, expect } from "vitest";
import {
  detectColdScan,
  TIME_PARTITIONED_TABLES,
} from "../../clickhouse/cold-scan-detector";

describe("detectColdScan", () => {
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
  });

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

  it("flags every tracked table when its time predicate is missing", () => {
    for (const [table, timeColumns] of Object.entries(TIME_PARTITIONED_TABLES)) {
      const cold = `SELECT 1 FROM ${table} WHERE TenantId = 'x'`;
      expect(detectColdScan(cold)).toBe(table);

      const warm = `SELECT 1 FROM ${table} WHERE ${timeColumns[0]} > 0`;
      expect(detectColdScan(warm)).toBeNull();
    }
  });

  it("flags the exact query captured live from prod (tree columns, no time predicate)", () => {
    const prodQuery = `SELECT SpanId, TraceId, TenantId, ParentSpanId, ParentTraceId, ParentIsRemote, Sampled, toUnixTimestamp64Milli(StartTime) AS StartTimeMs, DurationMs, SpanName FROM stored_spans WHERE (TenantId = 'project_x') AND (TraceId = 'abc') AND ((TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE (TenantId = 'project_x') AND (TraceId = 'abc') GROUP BY TenantId, TraceId, SpanId)) ORDER BY StartTimeMs ASC LIMIT 512`;
    expect(detectColdScan(prodQuery)).toBe("stored_spans");
  });
});

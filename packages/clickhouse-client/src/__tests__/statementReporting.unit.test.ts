/**
 * Structured logging for a ClickHouse statement's outcome. Chart correlation
 * reads these logs by field name, so the shape is a contract: `queryError`
 * not `error`, `warn` not `error` (the wrapper can't know if the caller recovers).
 */
import { describe, expect, it } from "vitest";

import { QUERY_CAUSE_FIELD } from "../resilience.ts";
import { StatementReporter, type StatementLogSink } from "../statementReporting.ts";

function recordingSink(): StatementLogSink & {
  lines: { level: "debug" | "warn" | "error"; fields: Record<string, unknown>; message: string }[];
} {
  const lines: {
    level: "debug" | "warn" | "error";
    fields: Record<string, unknown>;
    message: string;
  }[] = [];
  const record =
    (level: "debug" | "warn" | "error") => (fields: Record<string, unknown>, message: string) =>
      void lines.push({ level, fields, message });
  return { lines, debug: record("debug"), warn: record("warn"), error: record("error") };
}

describe("StatementReporter", () => {
  describe("given a query that failed", () => {
    /** @scenario Query failures are logged with structured metadata */
    it("emits a structured log with source, operation, durationMs, and the cause", () => {
      const outcomeLogger = recordingSink();
      const reporter = new StatementReporter({ outcomeLogger });
      const cause = new Error("Code: 241. Memory limit exceeded");

      reporter.failure({
        operation: "query",
        error: cause,
        durationMs: 42,
        params: { query: "SELECT 1" },
      });

      expect(outcomeLogger.lines).toHaveLength(1);
      const [line] = outcomeLogger.lines;
      expect(line!.fields).toMatchObject({
        source: "clickhouse",
        operation: "query",
        durationMs: 42,
        [QUERY_CAUSE_FIELD]: cause,
      });
    });

    /** @scenario A failed attempt raised to the caller is not itself an error */
    it("logs the attempt at warning level, not error", () => {
      const outcomeLogger = recordingSink();
      const reporter = new StatementReporter({ outcomeLogger });

      reporter.failure({
        operation: "query",
        error: new Error("boom"),
        durationMs: 5,
        params: {},
      });

      expect(outcomeLogger.lines.map((l) => l.level)).toEqual(["warn"]);
    });

    /** @scenario The cause rides on the named query-cause field */
    it("attaches the cause under queryError and emits no field named error", () => {
      const outcomeLogger = recordingSink();
      const reporter = new StatementReporter({ outcomeLogger });

      reporter.failure({
        operation: "query",
        error: new Error("boom"),
        durationMs: 5,
        params: {},
      });

      const [line] = outcomeLogger.lines;
      expect(QUERY_CAUSE_FIELD).toBe("queryError");
      expect(line!.fields).toHaveProperty("queryError");
      expect(line!.fields).not.toHaveProperty("error");
    });
  });

  describe("given a query that succeeded", () => {
    /** @scenario Query successes are logged at debug level */
    it("emits a structured debug log with source, operation, durationMs, and queryId", () => {
      const outcomeLogger = recordingSink();
      const reporter = new StatementReporter({ outcomeLogger });

      reporter.success({
        operation: "query",
        durationMs: 12,
        params: { query: "SELECT 1", query_id: "q-1" },
      });

      expect(outcomeLogger.lines).toHaveLength(1);
      const [line] = outcomeLogger.lines;
      expect(line!.level).toBe("debug");
      expect(line!.fields).toMatchObject({
        source: "clickhouse",
        operation: "query",
        durationMs: 12,
      });
      expect(line!.fields).toHaveProperty("queryId");
    });
  });
  describe("given the same cold-scan query shape repeated", () => {
    const query = (tenant: string) =>
      `SELECT * FROM evaluation_runs WHERE TenantId = '${tenant}' LIMIT 50`;
    const coldScanning = (outcomeLogger: StatementLogSink, now: () => number) =>
      new StatementReporter({
        outcomeLogger,
        now,
        detectColdScan: () => "evaluation_runs",
      });

    /** @scenario "A cold scan warns once per query shape per hour" */
    it("warns once per shape, whatever its literals", () => {
      const outcomeLogger = recordingSink();
      const reporter = coldScanning(outcomeLogger, () => 0);

      for (const tenant of ["a", "b", "c"]) {
        reporter.success({ operation: "query", durationMs: 5, params: { query: query(tenant) } });
      }

      expect(outcomeLogger.lines.filter((line) => line.level === "warn")).toHaveLength(1);
      expect(outcomeLogger.lines.filter((line) => line.level === "debug")).toHaveLength(2);
    });

    /** @scenario "A cold scan warns once per query shape per hour" */
    it("warns again after the quiet window and counts what it held back", () => {
      const outcomeLogger = recordingSink();
      let clock = 0;
      const reporter = coldScanning(outcomeLogger, () => clock);
      const run = () =>
        reporter.success({ operation: "query", durationMs: 5, params: { query: query("a") } });

      run();
      run();
      run();
      clock = 61 * 60 * 1000;
      run();

      const warns = outcomeLogger.lines.filter((line) => line.level === "warn");
      expect(warns).toHaveLength(2);
      expect(warns[0]!.fields.suppressedSincePrevious).toBe(0);
      expect(warns[1]!.fields.suppressedSincePrevious).toBe(2);
    });

    /** @scenario "A cold scan warns once per query shape per hour" */
    it("warns separately for a different shape", () => {
      const outcomeLogger = recordingSink();
      const reporter = coldScanning(outcomeLogger, () => 0);

      reporter.success({ operation: "query", durationMs: 5, params: { query: query("a") } });
      reporter.success({
        operation: "query",
        durationMs: 5,
        params: { query: "SELECT count() FROM evaluation_runs" },
      });

      expect(outcomeLogger.lines.filter((line) => line.level === "warn")).toHaveLength(2);
    });

    /** @scenario "A cold scan warns once per query shape per hour" */
    it("warns separately for long queries that differ only near their end", () => {
      const outcomeLogger = recordingSink();
      const reporter = coldScanning(outcomeLogger, () => 0);
      const columns = Array.from({ length: 300 }, (_, i) => `column_${i}`).join(", ");

      for (const tail of ["ORDER BY a", "ORDER BY b"]) {
        reporter.success({
          operation: "query",
          durationMs: 5,
          params: { query: `SELECT ${columns} FROM evaluation_runs ${tail}` },
        });
      }

      expect(outcomeLogger.lines.filter((line) => line.level === "warn")).toHaveLength(2);
    });

    it("reads an unterminated literal without stalling", () => {
      const outcomeLogger = recordingSink();
      const reporter = coldScanning(outcomeLogger, () => 0);

      reporter.success({
        operation: "query",
        durationMs: 5,
        params: { query: `SELECT * FROM evaluation_runs WHERE x = '${"\\'".repeat(50_000)}` },
      });

      expect(outcomeLogger.lines.filter((line) => line.level === "warn")).toHaveLength(1);
    });
  });
});

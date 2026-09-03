/**
 * Structured logging for a ClickHouse statement's outcome — the fields, the
 * level, and which field carries the cause. Chart correlation reads these
 * logs by field name, so the shape is a contract: `queryError` and not
 * `error`, `warn` and not `error` (the wrapper does not know whether the
 * caller will recover), and a debug line on success carrying enough to find
 * the slow one without the noise of every field on every request.
 */
import { describe, expect, it } from "vitest";
import { QUERY_CAUSE_FIELD } from "../resilience";
import { StatementReporter, type StatementLogSink } from "../statementReporting";

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
});

/**
 * A failed query is reported by origin: an error line for a built-in statement, a count for
 * a user's. The error line never holds statement text or parameter values.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import { LangWatchQLInvalidQueryError } from "@langwatch/analytics-contract";
import { counter } from "@langwatch/observability/metrics";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { createTestLogger, type TestLogLine } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LangWatchQLFailureReportService } from "../langwatch-ql-failure-report.service.ts";

const FAILURE_METRIC = "lwql_query_failure_total";
const SQL_MARKER = "SQL_MARKER_7f3a91";
const PARAM_MARKER = "PARAM_MARKER_c40d27";
const FAILURE_MESSAGE = "built-in LangWatchQL statement failed";
const PINO_BASE_FIELDS = new Set(["level", "time", "pid", "hostname", "msg"]);
const STATEMENT = `SELECT '${SQL_MARKER}' AS marker FROM trace_metrics WHERE TraceId = {trace:String}`;

let meter: RecordingMeterProvider;

beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
});
afterEach(() => meter.uninstall());

/** A ClickHouse-shaped error: the code is a string and the message echoes the whole request. */
function clickhouseError({ code }: { code: string }) {
  const echo = `Code: ${code}. while executing ${STATEMENT} with trace=${PARAM_MARKER}`;
  return Object.assign(new Error(echo), {
    code,
    cause: { message: echo, query: STATEMENT, params: { trace: PARAM_MARKER } },
  });
}

/** What the service itself put on a record, without the fields pino stamps on every line. */
function payloadOf(line: TestLogLine | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(line ?? {}).filter(([field]) => !PINO_BASE_FIELDS.has(field)),
  );
}

function reporter(origin: "built_in" | "user_written") {
  const { logger, lines } = createTestLogger();
  const service = LangWatchQLFailureReportService.create({
    logger,
    failures: counter({
      name: FAILURE_METRIC,
      description: "Failed LangWatchQL queries by origin",
    }),
    originOf: () => origin,
  });
  return { lines, service };
}

describe("given a built-in statement fails", () => {
  /** @scenario "A built-in failure is an error whatever the code" */
  it.each(["47", "215", "999"])(
    "writes one error record with only origin, code, project and hash for code %s",
    (code) => {
      const { lines, service } = reporter("built_in");

      service.reportFailure({
        projectId: "project-1",
        sql: STATEMENT,
        error: clickhouseError({ code }),
      });

      expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
      const record = payloadOf(lines.findLine("error", FAILURE_MESSAGE));
      expect(Object.keys(record).toSorted()).toEqual([
        "errorCode",
        "origin",
        "projectId",
        "statementHash",
      ]);
      expect(record).toMatchObject({
        origin: "built_in",
        errorCode: code,
        projectId: "project-1",
        statementHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    },
  );

  /** @scenario "The error line carries neither the statement nor its parameter values" */
  it("carries neither the statement text nor the parameter value anywhere in the record", () => {
    const { lines, service } = reporter("built_in");

    service.reportFailure({
      projectId: "project-1",
      sql: STATEMENT,
      error: clickhouseError({ code: "47" }),
    });

    expect(lines.findLine("error", FAILURE_MESSAGE)).toBeDefined();
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(SQL_MARKER);
    expect(serialized).not.toContain(PARAM_MARKER);
    expect(serialized).not.toContain("trace_metrics");
  });

  /** @scenario "A built-in failure outside the workbench carries no hash" */
  it("reports a server-written statement as built in without a statement hash", () => {
    const { lines, service } = reporter("built_in");

    service.reportBuiltInFailure({
      projectId: "project-1",
      error: clickhouseError({ code: "215" }),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    const record = payloadOf(lines.findLine("error", FAILURE_MESSAGE));
    expect(Object.keys(record).toSorted()).toEqual(["errorCode", "origin", "projectId"]);
    expect(record).toMatchObject({ origin: "built_in", errorCode: "215", projectId: "project-1" });
    expect(JSON.stringify(lines)).not.toContain(PARAM_MARKER);
  });
});

describe("given the engine failure reaches the door as a handled error", () => {
  /** @scenario "The error line carries neither the statement nor its parameter values" */
  it("records the handled code and keeps the echoed statement in reasons out of the record", () => {
    const { lines, service } = reporter("built_in");
    const error = new LangWatchQLInvalidQueryError({ reasons: [clickhouseError({ code: "215" })] });

    service.reportFailure({ projectId: "project-1", sql: STATEMENT, error });

    expect(payloadOf(lines.findLine("error", FAILURE_MESSAGE))).toMatchObject({
      errorCode: "lwql_invalid_query",
    });
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(SQL_MARKER);
    expect(serialized).not.toContain(PARAM_MARKER);
  });
});

describe("given a workbench statement runs through the report", () => {
  /** @scenario "A failed query on the tRPC door is reported with the statement exactly as sent" */
  it("reports the failure and rethrows the very same error object", async () => {
    const { lines, service } = reporter("built_in");
    const failure = clickhouseError({ code: "47" });

    const rejection = await service
      .reportingFailures({
        projectId: "project-1",
        sql: STATEMENT,
        run: async () => {
          throw failure;
        },
      })
      .catch((error: unknown) => error);

    expect(rejection).toBe(failure);
    expect(payloadOf(lines.findLine("error", FAILURE_MESSAGE))).toMatchObject({
      origin: "built_in",
      projectId: "project-1",
    });
  });

  /** @scenario "A successful query is not reported" */
  it("returns the result and reports nothing when the statement succeeds", async () => {
    const { lines, service } = reporter("built_in");

    const result = await service.reportingFailures({
      projectId: "project-1",
      sql: STATEMENT,
      run: async () => "rows",
    });

    expect(result).toBe("rows");
    expect(lines).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(0);
  });
});

describe("given a user-written statement fails", () => {
  /** @scenario "A user-written failure increments the failure count for its origin" */
  it("counts one failure for origin user_written and writes no error record", () => {
    const { lines, service } = reporter("user_written");

    service.reportFailure({
      projectId: "project-1",
      sql: STATEMENT,
      error: clickhouseError({ code: "47" }),
    });

    expect(meter.valueOf(FAILURE_METRIC, { origin: "user_written" })).toBe(1);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
  });
});

describe("given the service decides the origin itself", () => {
  /** @scenario "A statement edited by one character is user-written" */
  it("treats a statement that is not on the list as user-written, whatever the error code", () => {
    const { logger, lines } = createTestLogger();
    const service = LangWatchQLFailureReportService.create({
      logger,
      failures: counter({
        name: FAILURE_METRIC,
        description: "Failed LangWatchQL queries by origin",
      }),
    });

    service.reportFailure({
      projectId: "project-1",
      sql: STATEMENT,
      error: clickhouseError({ code: "47" }),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "user_written" })).toBe(1);
  });
});

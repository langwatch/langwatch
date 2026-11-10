/**
 * A failed query is reported by origin: an error line for a built-in statement, a count for
 * a user's. The error line never holds statement text or parameter values.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  LangWatchQLGranularityTooFineError,
  LangWatchQLInvalidQueryError,
  LangWatchQLNotPermittedError,
  LangWatchQLParameterInvalidError,
  LangWatchQLParameterMissingError,
  LangWatchQLReservedParameterSuppliedError,
  LangWatchQLUnknownIdentifierError,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { counter } from "@langwatch/observability/metrics";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { createTestLogger, type TestLogLine } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLangWatchQLService,
  EVERY_CATALOGUE_PERMISSION,
} from "../../app/__tests__/analytics.fixture.ts";
import { LangWatchQLAccessRefusalService } from "../langwatch-ql-access-refusal.service.ts";
import { LangWatchQLFailureReportService } from "../langwatch-ql-failure-report.service.ts";
import { catalogueWithout } from "./lwql-catalogue-access.fixture.ts";

const FAILURE_METRIC = "lwql_query_failure_total";
const SQL_MARKER = "SQL_MARKER_7f3a91";
const PARAM_MARKER = "PARAM_MARKER_c40d27";
const FAILURE_MESSAGE = "built-in LangWatchQL statement failed";
const WINDOW_PARAMETERS = ["dashboard_context_period_end", "dashboard_context_period_start"];
const PINO_BASE_FIELDS = new Set(["level", "time", "pid", "hostname", "msg"]);
/** A statement no stock widget holds, so the server reads it as user-written. */
const USER_SQL = `SELECT '${SQL_MARKER}' AS marker FROM trace_metrics WHERE TraceId = {trace:String}`;
/** The stock widget statements as saved widgets send them, so the server reads each as built in. */
const STOCK_STATEMENTS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../langwatch-ql/__tests__/fixtures/stock-widget-queries.json", import.meta.url),
    ),
    "utf8",
  ),
) as { label: string; sql: string }[];
const STOCK_SQL: string = STOCK_STATEMENTS[0]!.sql;
/** The stock gateway widget's statement: it needs gatewayUsage:view, so hiding that refuses it. */
const STOCK_GATEWAY_SQL: string = STOCK_STATEMENTS.find(
  ({ label }) => label === "fd-gateway/present",
)!.sql;
/** The one ledger the real service marks into and the reporter reads. */
const accessRefusals = LangWatchQLAccessRefusalService.create();
const lwql = createLangWatchQLService({ accessRefusals, executor: null, database: "analytics" });

let meter: RecordingMeterProvider;

beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
});
afterEach(() => meter.uninstall());

/** A ClickHouse-shaped error: the code is a string and the message echoes the whole request. */
function clickhouseError({ code, sql = STOCK_SQL }: { code: string; sql?: string }) {
  const echo = `Code: ${code}. while executing ${sql} with trace=${PARAM_MARKER}`;
  return Object.assign(new Error(echo), {
    code,
    cause: { message: echo, query: sql, params: { trace: PARAM_MARKER } },
  });
}

/** What the service itself put on a record, without the fields pino stamps on every line. */
function payloadOf(line: TestLogLine | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(line ?? {}).filter(([field]) => !PINO_BASE_FIELDS.has(field)),
  );
}

function reporter() {
  const { logger, lines } = createTestLogger();
  const service = LangWatchQLFailureReportService.create({
    accessRefusals,
    logger,
    failures: counter({
      name: FAILURE_METRIC,
      description: "Failed LangWatchQL queries by origin",
    }),
  });
  return { lines, service };
}

describe("given a built-in statement fails", () => {
  /** @scenario "A built-in failure is an error whatever the code" */
  it.each(["47", "215", "999"])(
    "writes one error record with only origin, code, project and hash for code %s",
    (code) => {
      const { lines, service } = reporter();

      service.reportFailure({
        projectId: "project-1",
        sql: STOCK_SQL,
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
    const { lines, service } = reporter();

    service.reportFailure({
      projectId: "project-1",
      sql: STOCK_SQL,
      error: clickhouseError({ code: "47" }),
    });

    expect(lines.findLine("error", FAILURE_MESSAGE)).toBeDefined();
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("dashboard_context_period_start");
    expect(serialized).not.toContain("trace_metrics");
    expect(serialized).not.toContain(PARAM_MARKER);
  });

  /** @scenario "A built-in failure outside the workbench carries no hash" */
  it("reports a server-written statement as built in without a statement hash", () => {
    const { lines, service } = reporter();

    service.reportBuiltInFailure({
      projectId: "project-1",
      source: "gateway",
      error: clickhouseError({ code: "215" }),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    const record = payloadOf(lines.findLine("error", FAILURE_MESSAGE));
    expect(Object.keys(record).toSorted()).toEqual(["errorCode", "origin", "projectId", "source"]);
    expect(record).toEqual({
      origin: "built_in",
      errorCode: "215",
      projectId: "project-1",
      source: "gateway",
    });
    expect(JSON.stringify(lines)).not.toContain(PARAM_MARKER);
  });
});

describe("given the engine failure reaches the door as a handled error", () => {
  /** @scenario "The error line carries neither the statement nor its parameter values" */
  it("records the handled code and keeps the echoed statement in reasons out of the record", () => {
    const { lines, service } = reporter();
    const error = new LangWatchQLInvalidQueryError({ reasons: [clickhouseError({ code: "215" })] });

    service.reportFailure({ projectId: "project-1", sql: STOCK_SQL, error });

    expect(payloadOf(lines.findLine("error", FAILURE_MESSAGE))).toMatchObject({
      errorCode: "lwql_invalid_query",
    });
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("trace_metrics");
    expect(serialized).not.toContain(PARAM_MARKER);
  });
});

describe("given a workbench statement runs through the report", () => {
  /** @scenario "A failed query on the tRPC door is reported with the statement exactly as sent" */
  it("reports the failure and rethrows the very same error object", async () => {
    const { lines, service } = reporter();
    const failure = clickhouseError({ code: "47" });

    const rejection = await service
      .reportingFailures({
        projectId: "project-1",
        sql: STOCK_SQL,
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
    const { lines, service } = reporter();

    const result = await service.reportingFailures({
      projectId: "project-1",
      sql: STOCK_SQL,
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
    const { lines, service } = reporter();

    service.reportFailure({
      projectId: "project-1",
      sql: USER_SQL,
      error: clickhouseError({ code: "47", sql: USER_SQL }),
    });

    expect(meter.valueOf(FAILURE_METRIC, { origin: "user_written" })).toBe(1);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
  });
});

describe("given the service decides the origin itself", () => {
  /** @scenario "A statement edited by one character is user-written" */
  it("treats a stock statement with one character added as user-written", () => {
    const { lines, service } = reporter();
    const sql = `${STOCK_SQL} `;

    service.reportFailure({
      projectId: "project-1",
      sql,
      error: clickhouseError({ code: "47", sql }),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "user_written" })).toBe(1);
  });
});

/**
 * The refusal a real validation throws when the caller's protections hide a view they could be
 * granted.
 */
function callerAccessRefusal(): LangWatchQLNotPermittedError {
  const error = refusalOf({
    sql: STOCK_GATEWAY_SQL,
    protections: { catalogue: catalogueWithout("gatewayUsage:view") },
  });
  expect(accessRefusals.isCallerAccessRefusal({ error })).toBe(true);
  return error;
}

/** A policy refusal that is not the caller's access: the view does not exist for anyone. */
function policyRefusal(): LangWatchQLNotPermittedError {
  const error = refusalOf({
    sql: "SELECT 1 FROM removed_view LIMIT 1",
    protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
  });
  expect(accessRefusals.isCallerAccessRefusal({ error })).toBe(false);
  return error;
}

function refusalOf({
  sql,
  protections,
}: {
  sql: string;
  protections: LangWatchQLProtections;
}): LangWatchQLNotPermittedError {
  try {
    lwql.validate({ projectId: "project-1", protections, sql });
  } catch (error) {
    if (error instanceof LangWatchQLNotPermittedError && error.code === "lwql_not_permitted") {
      return error;
    }
    throw error;
  }
  throw new Error(`expected "${sql}" to be refused`);
}

describe("given the caller's own access is refused", () => {
  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it.each([
    ["built_in", STOCK_SQL],
    ["user_written", USER_SQL],
  ] as const)(
    "writes no line and raises no count for a %s statement on the workbench path",
    (origin, sql) => {
      const { lines, service } = reporter();

      service.reportFailure({
        projectId: "project-1",
        sql,
        error: callerAccessRefusal(),
      });

      expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
      expect(meter.valueOf(FAILURE_METRIC, { origin })).toBe(0);
    },
  );

  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("writes no line and raises no count on the server-written path", () => {
    const { lines, service } = reporter();

    service.reportBuiltInFailure({
      projectId: "project-1",
      source: "gateway",
      error: callerAccessRefusal(),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(0);
  });

  /** @scenario "A built-in failure that is not an access refusal is still reported" */
  it("still reports a policy refusal that is not the caller's access, on both paths", () => {
    const { lines, service } = reporter();
    const error = policyRefusal();

    service.reportFailure({ projectId: "project-1", sql: STOCK_SQL, error });
    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(2);
  });

  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("rethrows the very same refusal from the workbench path", async () => {
    const { service } = reporter();
    const refusal = callerAccessRefusal();

    const rejection = await service
      .reportingFailures({
        projectId: "project-1",
        sql: STOCK_SQL,
        run: async () => {
          throw refusal;
        },
      })
      .catch((error: unknown) => error);

    expect(rejection).toBe(refusal);
  });
});

/** Refusals a caller earns with the values they send, whatever statement they send them with. */
const PARAMETER_REFUSALS = [
  {
    name: "a time window left out",
    refusal: () => new LangWatchQLParameterMissingError([...WINDOW_PARAMETERS]),
  },
  {
    name: "a step too fine for the window",
    refusal: () =>
      new LangWatchQLGranularityTooFineError({
        requestedGranularitySeconds: 60,
        windowSeconds: 31_536_000,
        maxBuckets: 1_000,
      }),
  },
  {
    name: "a reserved name supplied",
    refusal: () =>
      new LangWatchQLReservedParameterSuppliedError(["dashboard_context_granularity_seconds"]),
  },
];

describe("given the caller's own parameter values are refused on the workbench path", () => {
  /** @scenario "A refusal of the caller's own parameter values is neither reported nor counted" */
  it.each(PARAMETER_REFUSALS)(
    "writes no line and raises no count of any origin for $name",
    ({ refusal }) => {
      const { lines, service } = reporter();

      service.reportFailure({ projectId: "project-1", sql: STOCK_SQL, error: refusal() });
      service.reportFailure({ projectId: "project-1", sql: USER_SQL, error: refusal() });

      expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
      expect(meter.valueOf(FAILURE_METRIC)).toBe(0);
    },
  );

  /** @scenario "A statement failure still writes the built-in failure" */
  it("still reports a stock statement that names a column the view lacks", () => {
    const { lines, service } = reporter();

    service.reportFailure({
      projectId: "project-1",
      sql: STOCK_SQL,
      error: new LangWatchQLUnknownIdentifierError({ identifier: "Source" }),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    expect(payloadOf(lines.findLine("error", FAILURE_MESSAGE))).toMatchObject({
      origin: "built_in",
      errorCode: "lwql_unknown_identifier",
    });
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(1);
  });

  /** @scenario "A statement failure still writes the built-in failure" */
  it.each([
    ["built_in", STOCK_SQL],
    ["user_written", USER_SQL],
  ] as const)("still reports a wrong-type parameter value for a %s statement", (origin, sql) => {
    const { lines, service } = reporter();

    service.reportFailure({
      projectId: "project-1",
      sql,
      error: new LangWatchQLParameterInvalidError({ parameter: "start" }),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(origin === "built_in" ? 1 : 0);
    expect(meter.valueOf(FAILURE_METRIC, { origin })).toBe(1);
  });

  /** @scenario "A refusal of the caller's own parameter values is neither reported nor counted" */
  it("still reports a parameter refusal on the server-written path, whose values it sent", () => {
    const { lines, service } = reporter();

    service.reportBuiltInFailure({
      projectId: "project-1",
      source: "traces",
      error: new LangWatchQLParameterMissingError([...WINDOW_PARAMETERS]),
    });

    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(1);
  });
});

/**
 * A view the catalogue holds but the caller's protections hide is the caller's access refused;
 * a view the catalogue lacks is not. The member's response is the same either way.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import {
  LangWatchQLNotPermittedError,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { counter } from "@langwatch/observability/metrics";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TEST_RUN_TELEMETRY } from "../../app/__tests__/analytics.fixture.ts";
import { loadStockStatements } from "../../langwatch-ql/__tests__/stock-statements.ts";
import { MAX_VIOLATIONS } from "../../rules/langwatch-ql-validation-shape.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLAccessRefusalService } from "../langwatch-ql-access-refusal.service.ts";
import { LangWatchQLFailureReportService } from "../langwatch-ql-failure-report.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { catalogueWithout, EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const FAILURE_METRIC = "lwql_query_failure_total";
/** The stock gateway widget's own statement, as a saved widget sends it: built in. */
const STOCK_GATEWAY_SQL: string = loadStockStatements().find(
  ({ label }) => label === "fd-gateway/present",
)!.sql;
const accessRefusals = LangWatchQLAccessRefusalService.create();
const lwql = LangWatchQLService.create({
  accessRefusals,
  runTelemetry: TEST_RUN_TELEMETRY,
  executor: null,
  database: "analytics",
});
const withoutGatewayUsage = { catalogue: catalogueWithout("gatewayUsage:view") };

let meter: RecordingMeterProvider;
beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
});
afterEach(() => meter.uninstall());

function refusalOf({
  sql,
  via = lwql,
  protections = withoutGatewayUsage,
}: {
  sql: string;
  via?: LangWatchQLService;
  protections?: LangWatchQLProtections;
}): LangWatchQLNotPermittedError {
  try {
    via.validate({ projectId: "project-1", protections, sql });
  } catch (error) {
    if (error instanceof LangWatchQLNotPermittedError && error.code === "lwql_not_permitted") {
      return error;
    }
    throw error;
  }
  throw new Error(`expected "${sql}" to be refused`);
}

function reporter() {
  const { logger, lines } = createTestLogger();
  const service = LangWatchQLFailureReportService.create({
    accessRefusals,
    logger,
    failures: counter({ name: FAILURE_METRIC, description: "Failed LangWatchQL queries" }),
  });
  return { lines, service };
}

describe("given a view the catalogue holds but the caller's protections hide", () => {
  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("is the caller's access refused, and neither report path writes a line or a count", () => {
    const error = refusalOf({ sql: STOCK_GATEWAY_SQL });
    const { lines, service } = reporter();

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });
    service.reportFailure({ projectId: "project-1", sql: STOCK_GATEWAY_SQL, error });

    expect(accessRefusals.isCallerAccessRefusal({ error })).toBe(true);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(0);
  });

  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("answers the member exactly what a refusal built from the same violations answers", () => {
    const error = refusalOf({ sql: STOCK_GATEWAY_SQL });
    const unmarked = new LangWatchQLNotPermittedError(error.meta.violations as never);

    expect(Object.keys(error).toSorted()).toEqual(Object.keys(unmarked).toSorted());
    expect(JSON.stringify(error.meta)).toBe(JSON.stringify(unmarked.meta));
    expect(JSON.stringify(error)).toBe(JSON.stringify(unmarked));
    expect(JSON.stringify(error.meta)).not.toContain("refusedViews");
  });
});

describe("given a view the catalogue does not hold", () => {
  /** @scenario "A built-in failure that is not an access refusal is still reported" */
  it("is still reported and counted, alone or beside a hidden view", () => {
    const { lines, service } = reporter();

    for (const sql of [
      "SELECT 1 FROM removed_view LIMIT 1",
      "SELECT 1 FROM gateway_request_spend, removed_view LIMIT 1",
    ]) {
      const error = refusalOf({ sql });
      expect(accessRefusals.isCallerAccessRefusal({ error })).toBe(false);
      service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });
    }

    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(2);
  });
});

describe("given a caller's access refusal wrapped as the cause of another error", () => {
  /** @scenario "A wrapped access refusal is reported and counted" */
  it("is not an access refusal, and both report paths write the line and raise the count", () => {
    const marked = refusalOf({ sql: STOCK_GATEWAY_SQL });
    const wrapped = new Error("wrapped", { cause: marked });
    const { lines, service } = reporter();

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error: marked });
    service.reportFailure({ projectId: "project-1", sql: STOCK_GATEWAY_SQL, error: marked });
    expect(accessRefusals.isCallerAccessRefusal({ error: marked })).toBe(true);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(0);

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error: wrapped });
    service.reportFailure({ projectId: "project-1", sql: STOCK_GATEWAY_SQL, error: wrapped });
    expect(accessRefusals.isCallerAccessRefusal({ error: wrapped })).toBe(false);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(2);
  });
});

// An access nobody can satisfy cannot be declared: every access names at least one permission.
describe("given a view no caller could see", () => {
  const gateway = LWQL_VIEW_CATALOG.find((view) => view.name === "gateway_request_spend")!;
  const service = LangWatchQLService.create({
    accessRefusals,
    runTelemetry: TEST_RUN_TELEMETRY,
    executor: null,
    database: "analytics",
    views: [...LWQL_VIEW_CATALOG, { ...gateway, name: "orphan_view" }],
  });
  const everyGrant = { catalogue: EVERY_CATALOGUE_PERMISSION };

  /** @scenario "A view no caller could see is reported" */
  it("reports orphan_view on both paths, as no access of the caller's", () => {
    const sql = "SELECT 1 FROM orphan_view LIMIT 1";
    const error = refusalOf({ sql, via: service, protections: everyGrant });
    const { lines, service: report } = reporter();

    report.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });
    report.reportFailure({ projectId: "project-1", sql, error });

    expect(accessRefusals.isCallerAccessRefusal({ error })).toBe(false);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(1);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "user_written" })).toBe(1);
  });
});

describe("given a refusal cut off at the violation cap", () => {
  /** @scenario "A refusal cut off at the violation cap is reported" */
  it("is reported on both paths even though every violation is a hidden view", () => {
    const sql = `${Array.from({ length: 25 }, () => "SELECT 1 FROM gateway_request_spend").join(" UNION ALL ")} LIMIT 1`;
    const error = refusalOf({ sql });
    const { lines, service } = reporter();

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });
    service.reportFailure({ projectId: "project-1", sql, error });

    expect(error.meta.violations).toHaveLength(MAX_VIOLATIONS);
    expect(
      (error.meta.violations as readonly { code: string }[]).every(
        ({ code }) => code === "TABLE_NOT_ALLOWED",
      ),
    ).toBe(true);
    expect(accessRefusals.isCallerAccessRefusal({ error })).toBe(false);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(1);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "user_written" })).toBe(1);
  });
});

/**
 * A view the catalogue holds but the caller's protections hide is the caller's access refused;
 * a view the catalogue lacks is not. The member's response is the same either way.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import { LangWatchQLNotPermittedError } from "@langwatch/analytics-contract";
import { counter } from "@langwatch/observability/metrics";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isCallerAccessRefusal } from "../../rules/lwql-caller-access-refusal.rules.ts";
import { LangWatchQLFailureReportService } from "../langwatch-ql-failure-report.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { catalogueWithout } from "./lwql-catalogue-access.fixture.ts";

const FAILURE_METRIC = "lwql_query_failure_total";
const GATEWAY_PROBE = "SELECT 1 AS present FROM gateway_request_spend LIMIT 1";
const lwql = LangWatchQLService.create({ executor: null, database: "analytics" });
const withoutGatewayUsage = { catalogue: catalogueWithout("gatewayUsage:view") };

let meter: RecordingMeterProvider;
beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
});
afterEach(() => meter.uninstall());

function refusalOf(sql: string): LangWatchQLNotPermittedError {
  try {
    lwql.validate({ projectId: "project-1", protections: withoutGatewayUsage, sql });
  } catch (error) {
    return error as LangWatchQLNotPermittedError;
  }
  throw new Error(`expected "${sql}" to be refused`);
}

function reporter() {
  const { logger, lines } = createTestLogger();
  const service = LangWatchQLFailureReportService.create({
    logger,
    failures: counter({ name: FAILURE_METRIC, description: "Failed LangWatchQL queries" }),
    originOf: () => "built_in",
  });
  return { lines, service };
}

describe("given a view the catalogue holds but the caller's protections hide", () => {
  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("is the caller's access refused, and neither report path writes a line or a count", () => {
    const error = refusalOf(GATEWAY_PROBE);
    const { lines, service } = reporter();

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });
    service.reportFailure({ projectId: "project-1", sql: GATEWAY_PROBE, error });

    expect(isCallerAccessRefusal({ error })).toBe(true);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(0);
  });

  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("answers the member exactly what a refusal built from the same violations answers", () => {
    const error = refusalOf(GATEWAY_PROBE);
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
      const error = refusalOf(sql);
      expect(isCallerAccessRefusal({ error })).toBe(false);
      service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error });
    }

    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(2);
  });
});

describe("given a caller's access refusal wrapped as the cause of another error", () => {
  /** @scenario "A wrapped access refusal is reported and counted" */
  it("is not an access refusal, and both report paths write the line and raise the count", () => {
    const marked = refusalOf(GATEWAY_PROBE);
    const wrapped = new Error("wrapped", { cause: marked });
    const { lines, service } = reporter();

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error: marked });
    service.reportFailure({ projectId: "project-1", sql: GATEWAY_PROBE, error: marked });
    expect(isCallerAccessRefusal({ error: marked })).toBe(true);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(0);

    service.reportBuiltInFailure({ projectId: "project-1", source: "gateway", error: wrapped });
    service.reportFailure({ projectId: "project-1", sql: GATEWAY_PROBE, error: wrapped });
    expect(isCallerAccessRefusal({ error: wrapped })).toBe(false);
    expect(lines.filter((line) => line.level === 50)).toHaveLength(2);
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(2);
  });
});

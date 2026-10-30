/**
 * What a LangWatchQL run tells operations: its log line names the caller, the widget and a hash
 * of the statement, never its text, and its metrics count it by caller and outcome only.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import type { LangWatchQLRunTelemetry } from "@langwatch/analytics-contract";
import type * as Observability from "@langwatch/observability";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ info: [] as { fields: unknown; message: string }[] }));

vi.mock("@langwatch/observability", async (importActual) => {
  const actual = await importActual<typeof Observability>();
  return {
    ...actual,
    createLogger: () => ({
      info: (fields: unknown, message: string) => logged.info.push({ fields, message }),
      warn: () => void 0,
      error: () => void 0,
      debug: () => void 0,
    }),
  };
});

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { langWatchQLQueryHash } from "../../rules/langwatch-ql-run-telemetry.rules.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

/** A literal a customer might write, which must never reach the logs. */
const LITERAL = "acme-checkout-flow";
const SQL = `SELECT count() AS n FROM analytics.spans WHERE SpanName = '${LITERAL}' LIMIT 1`;
const WIDGET_RUN: LangWatchQLRunTelemetry = {
  caller: "dashboard_widget",
  dashboardId: "dashboard-1",
  widgetId: "widget-1",
  templateId: "llm-cost",
};

/** Answers every statement with the rows it was built with. */
class AnsweringExecutor extends LangWatchQLExecutorRepository {
  constructor(private readonly rows: Record<string, unknown>[]) {
    super();
  }

  execute(): Promise<LangWatchQLExecutionResult> {
    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows: this.rows,
      statistics: { elapsedMs: 250, rowsRead: 4_000, bytesRead: 0, rowsReturned: this.rows.length },
    });
  }
}

async function run({
  rows = [{ n: 3 }],
  sql = SQL,
  telemetry,
}: {
  rows?: Record<string, unknown>[];
  sql?: string;
  telemetry?: LangWatchQLRunTelemetry;
}) {
  const service = LangWatchQLService.create({
    executor: new AnsweringExecutor(rows),
    database: "analytics",
  });
  return service.execute({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: {
      catalogue: EVERY_CATALOGUE_PERMISSION,
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
    sql,
    ...(telemetry ? { telemetry } : {}),
  });
}

function lineNamed(message: string): Record<string, unknown> {
  const line = logged.info.find((entry) => entry.message === message);
  expect(line).toBeDefined();
  return line!.fields as Record<string, unknown>;
}

describe("LangWatchQL run telemetry", () => {
  let metrics: RecordingMeterProvider;

  beforeEach(() => {
    logged.info.length = 0;
    metrics = createRecordingMeterProvider();
    metrics.install();
  });

  afterEach(() => {
    metrics.uninstall();
  });

  describe("given a widget's run that answers rows", () => {
    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("logs the caller, the widget's ids, the hash and ok, and never the statement", async () => {
      await run({ telemetry: WIDGET_RUN });

      const line = lineNamed("LangWatchQL executed");
      expect(line).toMatchObject({
        caller: "dashboard_widget",
        dashboardId: "dashboard-1",
        widgetId: "widget-1",
        templateId: "llm-cost",
        queryHash: langWatchQLQueryHash(SQL),
        outcome: "ok",
      });
      expect(JSON.stringify(line)).not.toContain(LITERAL);
    });

    /** @scenario "Telemetry: query metrics carry only low-cardinality labels" */
    it("counts it by caller and outcome, and records its time and rows read by caller", async () => {
      await run({ telemetry: WIDGET_RUN });

      expect(
        metrics.valueOf("lwql_queries_total", { caller: "dashboard_widget", outcome: "ok" }),
      ).toBe(1);
      expect(
        metrics.valuesOf("lwql_query_duration_seconds", { caller: "dashboard_widget" }),
      ).toHaveLength(1);
      expect(metrics.valuesOf("lwql_rows_read", { caller: "dashboard_widget" })).toEqual([4_000]);
    });

    /** @scenario "Telemetry: query metrics carry only low-cardinality labels" */
    it("labels no metric with a project, dashboard or widget id", async () => {
      await run({ telemetry: WIDGET_RUN });

      const labels = new Set(metrics.recorded.flatMap(({ attributes }) => Object.keys(attributes)));
      expect([...labels].toSorted()).toEqual(["caller", "outcome"]);
    });
  });

  describe("given a run that answers no rows", () => {
    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("logs and counts it as empty", async () => {
      await run({ rows: [], telemetry: { caller: "rest_api" } });

      expect(lineNamed("LangWatchQL executed")).toMatchObject({
        caller: "rest_api",
        outcome: "empty",
      });
      expect(metrics.valueOf("lwql_queries_total", { caller: "rest_api", outcome: "empty" })).toBe(
        1,
      );
    });
  });

  describe("given a run the policy refuses", () => {
    /** @scenario "Telemetry: a failed query is logged and counted with its error code" */
    it("logs the caller, the hash and the error code, and counts it under that code", async () => {
      const refused = "SELECT * FROM system.tables";

      const error = (await run({ sql: refused, telemetry: { caller: "workbench" } }).then(
        () => ({ code: "answered" }),
        (thrown: unknown) => thrown,
      )) as { code: string };

      const line = lineNamed("LangWatchQL failed");
      expect(line).toMatchObject({
        caller: "workbench",
        queryHash: langWatchQLQueryHash(refused),
        outcome: error.code,
      });
      expect(error.code).toMatch(/^lwql_/);
      expect(
        metrics.valueOf("lwql_queries_total", { caller: "workbench", outcome: error.code }),
      ).toBe(1);
    });
  });

  describe("given two statements that differ only in their whitespace", () => {
    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("hashes them alike, and a different statement differently", () => {
      expect(langWatchQLQueryHash("SELECT 1\n  FROM t ")).toBe(
        langWatchQLQueryHash("SELECT 1 FROM t"),
      );
      expect(langWatchQLQueryHash("SELECT 2 FROM t")).not.toBe(
        langWatchQLQueryHash("SELECT 1 FROM t"),
      );
      expect(langWatchQLQueryHash("SELECT 1 FROM t")).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});

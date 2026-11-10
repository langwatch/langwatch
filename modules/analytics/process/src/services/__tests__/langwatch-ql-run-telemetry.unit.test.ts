/**
 * What a LangWatchQL run tells operations: its log line names the caller, the widget and a hash
 * of the statement, never its text, and its metrics count it by caller and outcome only.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import type { LangWatchQLRunTelemetry } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type * as Observability from "@langwatch/observability";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
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

import { createHmac } from "node:crypto";

import { ConfigParseError } from "@langwatch/config";

import {
  analyticsTestSecrets,
  TEST_SESSION_SECRET,
} from "../../app/__tests__/analytics-secrets.fixture.ts";
import { AnalyticsModule } from "../../app/analytics.app.ts";
import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import {
  langWatchQLQueryHash,
  langWatchQLQueryHashKey,
} from "../../rules/langwatch-ql-run-telemetry.rules.ts";
import { LangWatchQLRunTelemetryService } from "../langwatch-ql-run-telemetry.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

/** A literal a customer might write, which must never reach the logs. */
const LITERAL = "acme-checkout-flow";
const SQL = `SELECT count() AS n FROM analytics.spans WHERE SpanName = '${LITERAL}' LIMIT 1`;
/** The key the app derives from the deployment secret the fixture sets. */
const QUERY_HASH_KEY = langWatchQLQueryHashKey(TEST_SESSION_SECRET);
const hashOf = (sql: string) => langWatchQLQueryHash({ sql, key: QUERY_HASH_KEY });
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
    runTelemetry: LangWatchQLRunTelemetryService.create({ queryHashKey: QUERY_HASH_KEY }),
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

/** The app as boot builds it over memory twins, its secrets from `environment`. */
function analyticsApp(
  environment: Readonly<Record<string, string>> = { NEXTAUTH_SECRET: TEST_SESSION_SECRET },
): Promise<AnalyticsModule> {
  return AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org-1" }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "ENTERPRISE")),
      }),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    channels: { judge: createApiFixture<InstantEvalApi>() },
    repositories: MemoryAnalyticsRepositories.create(),
    config: {
      langwatchQl: {
        url: void 0,
        username: void 0,
        database: void 0,
        tenantSetting: void 0,
        postgresHost: void 0,
        accessModelMode: void 0,
        sqlSingleNode: void 0,
        clickhouseCluster: void 0,
        aggregateMaxMembers: void 0,
      },
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: analyticsTestSecrets(environment),
  });
}

/**
 * One statement through the key door, as `POST /api/v1/query` calls it, carrying a value the run
 * scope refuses before any project resolves. Resolves the code it was refused with.
 */
async function refusedAtTheKeyDoor({ sql }: { sql: string }): Promise<string> {
  const app = await analyticsApp();
  return app
    .runLangWatchQLForKey({
      reach: { kind: "project", projectId: "project-1" },
      sql,
      // A stray value, as a client could send it: the run scope refuses it with a 422.
      projects: "al" as never,
    })
    .then(
      () => "answered",
      (error: unknown) => (error as { code: string }).code,
    );
}

/**
 * One run through the app's member door, as the workbench and widget routes call it, with no
 * LangWatchQL identity provisioned. Resolves the code it was refused with.
 */
async function refusedAtTheDoor({
  sql,
  telemetry,
  projects,
}: {
  sql: string;
  telemetry: LangWatchQLRunTelemetry;
  projects?: string;
}): Promise<string> {
  const app = await analyticsApp();
  const run = app.executeLangWatchQL({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
    sql,
    telemetry,
    // A stray value, as a browser could send it: the run scope refuses it with a 422.
    ...(projects === undefined ? {} : { projects: projects as never, userId: "member-1" }),
  });
  return run.then(
    () => "answered",
    (error: unknown) => (error as { code: string }).code,
  );
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
        queryHash: hashOf(SQL),
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

  describe("given a run the policy refuses at the member door", () => {
    /** @scenario "Telemetry: a failed query is logged and counted with its error code" */
    it("logs the caller, the hash and the error code, and counts it under that code", async () => {
      const refused = "SELECT * FROM system.tables";

      const code = await refusedAtTheDoor({ sql: refused, telemetry: { caller: "workbench" } });

      expect(code).toMatch(/^lwql_/);
      expect(lineNamed("LangWatchQL failed")).toMatchObject({
        caller: "workbench",
        queryHash: hashOf(refused),
        outcome: code,
      });
      expect(metrics.valueOf("lwql_queries_total", { caller: "workbench", outcome: code })).toBe(1);
    });
  });

  describe("given a widget's run whose projects the run scope refuses", () => {
    /** @scenario "Telemetry: a failed query is logged and counted with its error code" */
    it("counts the refusal under the widget's caller, before any statement runs", async () => {
      const code = await refusedAtTheDoor({ sql: SQL, telemetry: WIDGET_RUN, projects: "al" });

      expect(lineNamed("LangWatchQL failed")).toMatchObject({
        caller: "dashboard_widget",
        widgetId: "widget-1",
        outcome: code,
      });
      expect(
        metrics.valueOf("lwql_queries_total", { caller: "dashboard_widget", outcome: code }),
      ).toBe(1);
      expect(logged.info.some(({ message }) => message === "LangWatchQL executed")).toBe(false);
    });
  });

  describe("given the app's one telemetry instance", () => {
    /** @scenario "Telemetry: query metrics carry only low-cardinality labels" */
    it("counts an answered run on the instance the service is given, not one of its own", async () => {
      const answered: unknown[] = [];
      const runTelemetry: Pick<LangWatchQLRunTelemetryService, "recordAnswered" | "fieldsFor"> = {
        recordAnswered: (input) => {
          answered.push(input);
          return "ok";
        },
        fieldsFor: () => ({ caller: "dashboard_widget" }),
      };
      const service = LangWatchQLService.create({
        executor: new AnsweringExecutor([{ n: 1 }]),
        database: "analytics",
        runTelemetry,
      });

      await service.execute({
        project: { id: "project-1", lwqlKey: "key-1" },
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql: SQL,
        telemetry: WIDGET_RUN,
      });

      expect(answered).toHaveLength(1);
      expect(metrics.recorded).toEqual([]);
    });
  });

  describe("given a run refused at the key door", () => {
    /** @scenario "Telemetry: a failed query is logged and counted with its error code" */
    /** @scenario "Telemetry: the caller is set by the server from the door the query came in by" */
    it("logs it and counts it under rest_api with the refusal's code", async () => {
      const code = await refusedAtTheKeyDoor({ sql: SQL });

      expect(code).not.toBe("answered");
      const line = lineNamed("LangWatchQL failed");
      expect(line).toMatchObject({ caller: "rest_api", queryHash: hashOf(SQL), outcome: code });
      expect(JSON.stringify(line)).not.toContain(LITERAL);
      expect(metrics.valueOf("lwql_queries_total", { caller: "rest_api", outcome: code })).toBe(1);
    });
  });

  describe("given a run that is cancelled, or fails with an error no module handled", () => {
    const telemetry = LangWatchQLRunTelemetryService.create({ queryHashKey: QUERY_HASH_KEY });

    /** @scenario "Telemetry: a failed query is logged and counted with its error code" */
    it("counts a cancelled run as aborted, not as an error", () => {
      telemetry.recordFailed({
        telemetry: WIDGET_RUN,
        sql: SQL,
        error: new DOMException("The run was cancelled", "AbortError"),
      });

      expect(lineNamed("LangWatchQL failed")).toMatchObject({ outcome: "aborted" });
      expect(
        metrics.valueOf("lwql_queries_total", { caller: "dashboard_widget", outcome: "aborted" }),
      ).toBe(1);
    });

    /** @scenario "Telemetry: a failed query is logged and counted with its error code" */
    it("counts an error with no handled code as unhandled", () => {
      telemetry.recordFailed({
        telemetry: { caller: "workbench" },
        sql: SQL,
        error: new TypeError("Cannot read properties of undefined"),
      });

      expect(lineNamed("LangWatchQL failed")).toMatchObject({ outcome: "unhandled" });
      expect(
        metrics.valueOf("lwql_queries_total", { caller: "workbench", outcome: "unhandled" }),
      ).toBe(1);
    });
  });

  describe("given two statements that differ only in their whitespace", () => {
    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("hashes them alike, and a different statement differently", () => {
      expect(hashOf("SELECT 1\n  FROM t ")).toBe(hashOf("SELECT 1 FROM t"));
      expect(hashOf("SELECT 2 FROM t")).not.toBe(hashOf("SELECT 1 FROM t"));
      expect(hashOf("SELECT 1 FROM t")).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("given the deployment secret the query hash is keyed from", () => {
    const statement = "SELECT 1 FROM t";

    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("hashes a statement alike under the same secret, and differently under another", () => {
      const other = langWatchQLQueryHashKey("another-deployment-secret");

      expect(
        langWatchQLQueryHash({ sql: statement, key: langWatchQLQueryHashKey(TEST_SESSION_SECRET) }),
      ).toBe(hashOf(statement));
      expect(langWatchQLQueryHash({ sql: statement, key: other })).not.toBe(hashOf(statement));
    });

    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("never keys the hash with the secret itself, as api-key's pepper hash does", () => {
      const underTheSecretItself = createHmac("sha256", TEST_SESSION_SECRET)
        .update(statement)
        .digest("hex")
        .slice(0, 16);

      expect(hashOf(statement)).not.toBe(underTheSecretItself);
    });

    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("refuses to start when no deployment secret is set, rather than hashing unkeyed", async () => {
      await expect(analyticsApp({})).rejects.toBeInstanceOf(ConfigParseError);
    });

    /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
    it("keys from API_KEY_PEPPER first, then CREDENTIALS_SECRET, then NEXTAUTH_SECRET", async () => {
      const app = await analyticsApp({
        API_KEY_PEPPER: "pepper",
        CREDENTIALS_SECRET: "credentials",
        NEXTAUTH_SECRET: TEST_SESSION_SECRET,
      });
      const refused = "SELECT * FROM system.tables";

      await app
        .executeLangWatchQL({
          project: { id: "project-1", lwqlKey: "key-1" },
          protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
          sql: refused,
          telemetry: { caller: "workbench" },
        })
        .catch(() => void 0);

      expect(lineNamed("LangWatchQL failed")).toMatchObject({
        queryHash: langWatchQLQueryHash({ sql: refused, key: langWatchQLQueryHashKey("pepper") }),
      });
    });
  });
});

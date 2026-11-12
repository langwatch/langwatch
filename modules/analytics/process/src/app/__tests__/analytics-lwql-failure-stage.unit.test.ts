/**
 * `AnalyticsModule.executeWorkbenchQuery`: a failure is reported once the request's own scope is
 * accepted; a refused scope is not the statement failing.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import type * as observabilityModule from "@langwatch/observability";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

import { hashStatement } from "../../rules/lwql-statement-origin.rules.ts";
import { loadStockStatements } from "../../langwatch-ql/__tests__/stock-statements.ts";
import { analyticsProof } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { project } from "../../services/__tests__/project.fixture.ts";
import { analyticsTestSecrets } from "./analytics-secrets.fixture.ts";

const QUERY_FAILURE_LOGGER = "langwatch:analytics:lwql:query-failure";
const errorLines = vi.hoisted(() => [] as { fields: Record<string, unknown>; message: string }[]);

// Only the failure logger is replaced, so the module's other loggers stay real.
vi.mock("@langwatch/observability", async (importOriginal) => {
  const original = await importOriginal<typeof observabilityModule>();
  return {
    ...original,
    createLogger: (name: string) =>
      name === QUERY_FAILURE_LOGGER
        ? {
            error: (fields: Record<string, unknown>, message: string) =>
              errorLines.push({ fields, message }),
          }
        : original.createLogger(name),
  };
});

// This package may run with `isolate: false`: reset so the import below binds the mock.
vi.resetModules();

const { AnalyticsModule } = await import("../analytics.app.ts");

const AGGREGATE = "project_aggregate";
const MEMBERS = ["project_a", "project_b"];
const FAILURE_METRIC = "lwql_query_failure_total";
/** The window and step a dashboard hands a stock widget, so only the statement itself can fail. */
const DASHBOARD_PERIOD = {
  timeWindow: { start: "2026-03-10T00:00:00.000Z", end: "2026-03-11T00:00:00.000Z" },
  granularitySeconds: 3600,
};
const STOCK_SQL: string = loadStockStatements()[0]!.sql;

let meter: RecordingMeterProvider;

beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
  errorLines.length = 0;
});
afterEach(() => meter.uninstall());

async function harness({ keyless = [] }: { keyless?: readonly string[] } = {}) {
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "org-free",
        findById: async (id) => {
          return keyless.includes(id) ? null : project(id);
        },
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "FREE")),
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
    secrets: analyticsTestSecrets(),
  });

  const outcome = (run: Promise<unknown>) =>
    run.then(
      () => "executed",
      (error: unknown) =>
        error instanceof Error && "code" in error ? String(error.code) : "unknown",
    );
  const runStock = ({
    sql = STOCK_SQL,
    parameters,
    period,
  }: {
    sql?: string;
    parameters?: Record<string, unknown>;
    period?: typeof DASHBOARD_PERIOD;
  } = {}) =>
    outcome(
      app.executeWorkbenchQuery({
        ...(parameters ? { parameters } : {}),
        ...period,
        project: { id: AGGREGATE, lwqlKey: "lwql-aggregate" },
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql,
        authorization: analyticsProof({
          projectId: AGGREGATE,
          shared: MEMBERS.map((projectId) => ({ projectId, from: 0 })),
        }),
      }),
    );

  return { runStock };
}

describe("given a stock statement on the workbench door", () => {
  /** @scenario "A refused project scope writes no built-in failure" */
  it("reports nothing when the request's own projects are refused", async () => {
    const { runStock } = await harness({ keyless: ["project_b"] });

    expect(await runStock()).toBe("lwql_member_key_missing");
    expect(meter.valueOf(FAILURE_METRIC)).toBe(0);
  });

  /** @scenario "A statement failure still writes the built-in failure" */
  it("reports the failure once the scope is accepted and the statement fails", async () => {
    const { runStock } = await harness();

    expect(await runStock({ period: DASHBOARD_PERIOD })).not.toBe("executed");
    expect(meter.valueOf(FAILURE_METRIC, { origin: "built_in" })).toBe(1);
  });

  /** @scenario "A failed query on the tRPC door is reported with the statement exactly as sent" */
  it("writes the built-in error line with the request's project id and statement hash", async () => {
    const { runStock } = await harness();

    await runStock({ period: DASHBOARD_PERIOD });

    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]!.fields).toMatchObject({
      origin: "built_in",
      projectId: AGGREGATE,
      statementHash: hashStatement({ sql: STOCK_SQL }),
    });
  });

  /** @scenario "A refusal of the caller's own parameter values is neither reported nor counted" */
  it("reports nothing when the stock statement is sent without its time window", async () => {
    const { runStock } = await harness();

    expect(await runStock()).toBe("lwql_parameter_missing");
    expect(meter.valueOf(FAILURE_METRIC)).toBe(0);
  });

  /** @scenario "A reserved parameter name supplied writes no built-in failure" */
  it("reports nothing when a reserved parameter name is supplied", async () => {
    const { runStock } = await harness();

    const code = await runStock({ parameters: { dashboard_context_granularity_seconds: 60 } });

    expect(code).toBe("lwql_reserved_parameter_supplied");
    expect(meter.valueOf(FAILURE_METRIC)).toBe(0);
  });

  /** @scenario "A reserved name is refused before the statement text is read" */
  it("answers the reserved-name refusal for a request whose text is also broken", async () => {
    const { runStock } = await harness();

    const code = await runStock({
      sql: "SELEC broken (",
      parameters: { dashboard_context_granularity_seconds: 60 },
    });

    expect(code).toBe("lwql_reserved_parameter_supplied");
    expect(meter.valueOf(FAILURE_METRIC)).toBe(0);
  });
});

/**
 * The governed analytics SQL endpoints, driven through the real HTTP app.
 *
 * Every request here goes through the shipped Hono app — auth middleware, RBAC,
 * validator, service, executor — against a ClickHouse 25.10 container carrying
 * the *shipped* migrations, the shipped provisioning, and the shipped views.
 * Nothing is stubbed between the request and the database except the executor's
 * connection details, which is the only thing a deployment would supply.
 *
 * That matters for one claim in particular. The isolation proof already showed
 * the row policies hold when a query is issued *directly* as the restricted
 * identity; what it could not show is that the gateway actually uses that
 * identity, sends the right tenant capability, and never substitutes the
 * application's own connection. Those are gateway facts, and this is where they
 * are checked — through the public surface, as the issue's own security-test
 * rule demands.
 *
 * Three habits carried over from the proof suite, for the same reasons:
 *
 *  - Every "no foreign rows" claim is paired with an administrator-side control
 *    proving the foreign rows exist. An absence check passes against an empty
 *    database.
 *  - Every refusal is asserted by `code`, never by message prose.
 *  - Two tenants throughout, both seeded, so an isolation assertion has
 *    something to fail on.
 *
 * @see specs/analytics/governed-sql-api.feature
 * @see ~/server/analytics/governed-sql — the service under test
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { projectFactory } from "~/factories/project.factory";
import {
  GovernedSqlService,
  createGovernedSqlExecutor,
  governedTenantCapability,
  setGovernedSqlService,
} from "~/server/analytics/governed-sql";
import { GOVERNED_VIEW_CATALOG } from "~/server/analytics/governed-sql/catalog/governedViews";
import {
  type GovernedClickHouseHarness,
  selectRows,
  startGovernedClickHouse,
} from "~/server/analytics/governed-sql/__tests__/governedClickHouseHarness";
import {
  SHIPPED_GOVERNED_DEDUP,
  governedViewSetupStatements,
} from "~/server/analytics/governed-sql/views";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

/** Rows seeded per tenant, per dataset. Small: this suite proves shape, not scale. */
const SEEDED_TRACES = 6;
const SEEDED_EVALUATIONS = 4;
const SEEDED_SIMULATIONS = 2;

/** Everything is seeded at one instant, inside the window the queries ask for. */
const SEED_AT = "2026-02-20 12:00:00.000";
const SEED_WINDOW = {
  from: "2026-02-16 00:00:00.000",
  to: "2026-02-23 00:00:00.000",
} as const;

/** The trace seeded twice, so "returned one row" and "returned the newer one" are separable. */
const DEDUP = {
  suffix: "dedup",
  staleSpanCount: 1,
  latestSpanCount: 99,
  staleUpdatedAt: "2026-02-20 12:00:00.000",
  latestUpdatedAt: "2026-02-20 12:00:01.000",
} as const;

/** Captured content, per tenant, so a leak names the exact string that escaped. */
function content(tenantId: string) {
  return {
    traceInput: `CAPTURED-TRACE-INPUT-${tenantId}`,
    traceOutput: `CAPTURED-TRACE-OUTPUT-${tenantId}`,
    spanInput: `CAPTURED-SPAN-INPUT-${tenantId}`,
    spanOutput: `CAPTURED-SPAN-OUTPUT-${tenantId}`,
    evaluationInputs: `CAPTURED-EVALUATION-INPUTS-${tenantId}`,
  };
}

function traceRow({
  tenantId,
  traceId,
  updatedAt = SEED_AT,
  spanCount = 3,
  durationMs,
}: {
  tenantId: string;
  traceId: string;
  updatedAt?: string;
  spanCount?: number;
  durationMs: number;
}) {
  const marks = content(tenantId);
  return {
    ProjectionId: `${tenantId}/${traceId}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "1",
    Attributes: { "gen_ai.request.model": "gpt-5-mini" },
    OccurredAt: SEED_AT,
    UpdatedAt: updatedAt,
    ComputedIOSchemaVersion: "1",
    ComputedInput: `${marks.traceInput}/${traceId}`,
    ComputedOutput: `${marks.traceOutput}/${traceId}`,
    TotalDurationMs: durationMs,
    SpanCount: spanCount,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: ["gpt-5-mini"],
    TotalCost: 0.0042,
    TokensEstimated: false,
    TraceName: "checkout",
  };
}

/**
 * Seeds one tenant across every governed dataset.
 *
 * Written here rather than borrowed from the proof harness because the tenant
 * ids that matter to this suite are real project ids, and the harness seeds its
 * own two fixtures — which stay in the tables, and are exactly the third-party
 * rows a leak assertion wants present.
 */
async function seedTenant({
  admin,
  database,
  tenantId,
}: {
  admin: ClickHouseClient;
  database: string;
  tenantId: string;
}): Promise<void> {
  const marks = content(tenantId);
  const traceIds = [...Array(SEEDED_TRACES).keys()].map(
    (index) => `${tenantId}-trace-${index}`,
  );

  await admin.insert({
    table: `${database}.trace_summaries`,
    format: "JSONEachRow",
    values: traceIds.map((traceId, index) =>
      traceRow({ tenantId, traceId, durationMs: 100 * (index + 1) }),
    ),
  });

  // Separate inserts, so the two versions land in separate parts and the view
  // has something to collapse. Merges are stopped by the harness.
  for (const version of [
    { updatedAt: DEDUP.staleUpdatedAt, spanCount: DEDUP.staleSpanCount },
    { updatedAt: DEDUP.latestUpdatedAt, spanCount: DEDUP.latestSpanCount },
  ]) {
    await admin.insert({
      table: `${database}.trace_summaries`,
      format: "JSONEachRow",
      values: [
        traceRow({
          tenantId,
          traceId: `${tenantId}-${DEDUP.suffix}`,
          durationMs: 500,
          ...version,
        }),
      ],
    });
  }

  await admin.insert({
    table: `${database}.stored_spans`,
    format: "JSONEachRow",
    values: traceIds.map((traceId, index) => ({
      ProjectionId: `${tenantId}/span-${index}`,
      TenantId: tenantId,
      TraceId: traceId,
      SpanId: `${tenantId}-span-${index}`,
      Sampled: 1,
      StartTime: SEED_AT,
      EndTime: SEED_AT,
      DurationMs: 250,
      SpanName: index % 2 === 0 ? "llm.call" : "retrieval",
      SpanKind: 3,
      ServiceName: "api",
      ScopeName: "langwatch",
      ResourceAttributes: { "service.name": "api" },
      SpanAttributes: {
        "gen_ai.request.model": "gpt-5-mini",
        "langwatch.input": marks.spanInput,
        "langwatch.output": marks.spanOutput,
        "gen_ai.prompt": `${marks.spanInput}-prompt`,
      },
      Cost: 0.0021,
    })),
  });

  await admin.insert({
    table: `${database}.evaluation_runs`,
    format: "JSONEachRow",
    values: [...Array(SEEDED_EVALUATIONS).keys()].map((index) => ({
      ProjectionId: `${tenantId}/eval-${index}`,
      TenantId: tenantId,
      EvaluationId: `${tenantId}-eval-${index}`,
      Version: "1",
      EvaluatorId: "quality",
      EvaluatorType: "llm_judge",
      EvaluatorName: "Quality",
      TraceId: traceIds[index % traceIds.length],
      Status: "processed",
      Score: 0.5 + index / 10,
      Passed: index % 2,
      Details: "scored on rubric",
      Inputs: `${marks.evaluationInputs}/${index}`,
      ScheduledAt: SEED_AT,
      UpdatedAt: SEED_AT,
      LastProcessedEventId: "seed",
    })),
  });

  await admin.insert({
    table: `${database}.simulation_runs`,
    format: "JSONEachRow",
    values: [...Array(SEEDED_SIMULATIONS).keys()].map((index) => ({
      ProjectionId: `${tenantId}/sim-${index}`,
      TenantId: tenantId,
      ScenarioRunId: `${tenantId}-sim-${index}`,
      ScenarioId: "checkout",
      BatchRunId: `${tenantId}-batch-${index}`,
      ScenarioSetId: "default",
      Version: "1",
      Status: "SUCCESS",
      Name: "checkout flow",
      "Messages.Id": ["m1"],
      "Messages.Role": ["assistant"],
      "Messages.Content": [`${marks.spanOutput}-simulated`],
      "Messages.TraceId": [traceIds[0]!],
      "Messages.Rest": ["{}"],
      TraceIds: [traceIds[0]!],
      Verdict: "success",
      Reasoning: `${marks.spanOutput}-reasoning`,
      MetCriteria: ["completes checkout"],
      UnmetCriteria: [],
      StartedAt: SEED_AT,
      CreatedAt: SEED_AT,
      UpdatedAt: SEED_AT,
    })),
  });
}

describe("given the governed analytics SQL REST endpoints", () => {
  let harness: GovernedClickHouseHarness;
  let organization: Organization;
  let team: Team;
  /** Fully permitted: the platform default policy captures every category. */
  let openProject: Project;
  /** Content-gated by a `restrict` data-privacy rule on input and output. */
  let gatedProject: Project;
  let database: string;
  let facts: string;

  const queryPath = (project: Project) =>
    `/api/v1/projects/${project.id}/analytics/query/clickhouse`;
  const schemaPath = (project: Project) =>
    `/api/v1/projects/${project.id}/analytics/schema`;

  const post = (
    project: Project,
    body: unknown,
    options: { path?: string; token?: string | null } = {},
  ) =>
    app.request(options.path ?? queryPath(project), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.token === null
          ? {}
          : { "X-Auth-Token": options.token ?? project.apiKey }),
      },
      body: JSON.stringify(body),
    });

  /** Runs SQL through the endpoint and asserts it succeeded before returning it. */
  const run = async (
    project: Project,
    sql: string,
    parameters?: Record<string, unknown>,
  ) => {
    const response = await post(project, {
      sql,
      ...(parameters ? { parameters } : {}),
    });
    const body = (await response.json()) as Record<string, any>;
    expect(
      response.status,
      `query failed: ${JSON.stringify(body)}`,
    ).toBe(200);
    return body;
  };

  /** Runs SQL expected to be refused, and returns the parsed error body. */
  const refuse = async (project: Project, sql: string) => {
    const response = await post(project, { sql });
    const body = (await response.json()) as Record<string, any>;
    expect(
      response.status,
      `expected a refusal, got ${response.status}: ${JSON.stringify(body)}`,
    ).toBeGreaterThanOrEqual(400);
    return body;
  };

  /** Administrator-side row count per tenant: the control behind every zero-rows claim. */
  const adminRowCount = async (table: string, tenantId: string) => {
    const [row] = await selectRows<{ value: string }>(
      harness.admin,
      `SELECT count() AS value FROM ${facts}.${table} WHERE TenantId = '${tenantId}'`,
    );
    return Number(row!.value);
  };

  beforeAll(async () => {
    harness = await startGovernedClickHouse({
      suite: "restapi",
      facts: "migrated",
    });
    database = harness.names.database;
    facts = harness.factDatabase;
    await harness.applyAsAdmin(
      governedViewSetupStatements({
        names: harness.names,
        sourceDatabase: facts,
        dedup: SHIPPED_GOVERNED_DEDUP,
      }),
    );

    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi
          .fn()
          .mockResolvedValue(FREE_PLAN) as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    organization = await prisma.organization.create({
      data: { name: "Governed SQL Org", slug: `governed-sql-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Governed SQL Team",
        slug: `governed-sql-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    openProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `open-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    gatedProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `gated-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    // Written before the first request, because the resolved policy is cached
    // per project on first read: a rule created afterwards would not be seen
    // and the "gated caller" would silently be a permitted one.
    await prisma.dataPrivacyPolicy.create({
      data: {
        organizationId: organization.id,
        scopeType: "PROJECT",
        scopeId: gatedProject.id,
        personalOnly: false,
        config: {
          categories: {
            input: { disposition: "restrict" },
            output: { disposition: "restrict" },
          },
        },
      },
    });

    // The key map is what turns a capability into a tenant. Populating it is a
    // deployment concern; here it is two rows, using the same derivation the
    // gateway sends — if the two ever disagreed, every query would succeed and
    // return nothing, which reads exactly like a tenant with no data.
    await harness.admin.insert({
      table: `${database}.${harness.names.keyMapTable}`,
      format: "JSONEachRow",
      values: [openProject, gatedProject].map((project) => ({
        KeyHash: governedTenantCapability({ apiKey: project.apiKey }),
        TenantId: project.id,
      })),
    });

    for (const project of [openProject, gatedProject]) {
      await seedTenant({
        admin: harness.admin,
        database: facts,
        tenantId: project.id,
      });
    }

    setGovernedSqlService(
      new GovernedSqlService({
        executor: createGovernedSqlExecutor({
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        }),
        database,
      }),
    );
  }, 600_000);

  afterAll(async () => {
    setGovernedSqlService(null);
    if (organization) {
      await prisma.dataPrivacyPolicy.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.project.deleteMany({ where: { teamId: team.id } });
      await prisma.team.delete({ where: { id: team.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    await harness?.stop();
  });

  describe("when the caller is not authenticated", () => {
    it("refuses the request before any query is considered", async () => {
      const response = await post(
        openProject,
        { sql: "SELECT 1" },
        { token: null },
      );
      expect(response.status).toBe(401);
    });
  });

  describe("when an authenticated client submits native ClickHouse SQL", () => {
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it("runs a query with CTEs, joins, windows, percentiles, aliases and math", async () => {
      const body = await run(
        openProject,
        `WITH recent AS (
           SELECT TraceId, TotalDurationMs, OccurredAt
           FROM ${database}.traces
           WHERE OccurredAt >= toDateTime64('${SEED_WINDOW.from}', 3)
             AND OccurredAt < toDateTime64('${SEED_WINDOW.to}', 3)
         )
         SELECT
           s.SpanName AS operation,
           count() AS calls,
           round(quantile(0.95)(r.TotalDurationMs) / 1000, 3) AS p95_seconds,
           row_number() OVER (ORDER BY count() DESC) AS rank
         FROM recent AS r
         INNER JOIN ${database}.spans AS s ON s.TraceId = r.TraceId
         WHERE r.TraceId IN (SELECT TraceId FROM ${database}.traces)
         GROUP BY operation
         ORDER BY calls DESC`,
      );

      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.columns.map((column: any) => column.name)).toEqual([
        "operation",
        "calls",
        "p95_seconds",
        "rank",
      ]);
    });

    /** @scenario "Results carry typed columns, rows, execution statistics, truncation state, and diagnostics" */
    it("answers with typed columns, rows, execution statistics, truncation state and diagnostics", async () => {
      const body = await run(
        openProject,
        `SELECT TraceId, TotalDurationMs FROM ${database}.traces ORDER BY TraceId LIMIT 3`,
      );

      expect(body.columns).toEqual([
        { name: "TraceId", type: "String" },
        { name: "TotalDurationMs", type: "Int64" },
      ]);
      expect(body.rows).toHaveLength(3);
      expect(body.statistics.rowsRead).toBeGreaterThan(0);
      expect(body.statistics.rowsReturned).toBe(3);
      expect(typeof body.statistics.elapsedMs).toBe("number");
      expect(typeof body.statistics.bytesRead).toBe("number");
      expect(body.truncated).toBe(false);
      expect(body.diagnostics).toEqual([]);
    });

    /** @scenario "A governed view returns only the calling tenant's rows" */
    it("reads every governed view, seeing exactly its own tenant's rows", async () => {
      for (const view of GOVERNED_VIEW_CATALOG) {
        const expected = await adminRowCount(
          view.sourceTable,
          openProject.id,
        );
        expect(
          expected,
          `${view.sourceTable} holds no rows for the calling tenant — the read below proves nothing`,
        ).toBeGreaterThan(0);

        const body = await run(
          openProject,
          `SELECT DISTINCT TenantId FROM ${database}.${view.name}`,
        );
        expect(
          body.rows.map((row: any) => row.TenantId),
          `${view.name} returned rows of another tenant`,
        ).toEqual([openProject.id]);
      }
    });

    /** @scenario "A governed view returns one row per logical record, the latest version" */
    it("collapses a twice-written trace to its newer version", async () => {
      const traceId = `${openProject.id}-${DEDUP.suffix}`;
      const versions = await selectRows<{ SpanCount: number }>(
        harness.admin,
        `SELECT SpanCount FROM ${facts}.trace_summaries ` +
          `WHERE TenantId = '${openProject.id}' AND TraceId = '${traceId}'`,
      );
      expect(
        versions.length,
        "the source table holds one version — a view that does not deduplicate would pass this",
      ).toBe(2);

      const body = await run(
        openProject,
        `SELECT SpanCount FROM ${database}.traces WHERE TraceId = '${traceId}'`,
      );
      expect(body.rows).toHaveLength(1);
      expect(
        Number(body.rows[0].SpanCount),
        "the endpoint returned the stale version",
      ).toBe(DEDUP.latestSpanCount);
    });

    it("resolves an unqualified dataset name to the governed database", async () => {
      const body = await run(openProject, "SELECT count() AS value FROM traces");
      expect(Number(body.rows[0].value)).toBeGreaterThan(0);
    });
  });

  describe("when two tenants have rows", () => {
    /** @scenario "A governed view returns only the calling tenant's rows" */
    it("gives each caller its own tenant and never the other's", async () => {
      for (const [caller, other] of [
        [openProject, gatedProject],
        [gatedProject, openProject],
      ] as const) {
        expect(
          await adminRowCount("trace_summaries", other.id),
          "the other tenant has no rows — 'no foreign rows returned' would be vacuous",
        ).toBeGreaterThan(0);

        const body = await run(
          caller,
          `SELECT DISTINCT TenantId FROM ${database}.traces`,
        );
        expect(body.rows.map((row: any) => row.TenantId)).toEqual([caller.id]);
      }
    });

    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("returns nothing, not everything, for a predicate naming the other tenant", async () => {
      const foreignRows = await adminRowCount(
        "trace_summaries",
        gatedProject.id,
      );
      expect(foreignRows).toBeGreaterThan(0);

      const body = await run(
        openProject,
        `SELECT count() AS value FROM ${database}.traces ` +
          `WHERE TenantId = '${gatedProject.id}'`,
      );
      expect(
        Number(body.rows[0].value),
        `the endpoint reached ${foreignRows} foreign rows`,
      ).toBe(0);

      // The same shape with the caller's own id, so the zero above is the row
      // policy rather than a query that matches nothing.
      const own = await run(
        openProject,
        `SELECT count() AS value FROM ${database}.traces ` +
          `WHERE TenantId = '${openProject.id}'`,
      );
      expect(Number(own.rows[0].value)).toBeGreaterThan(0);
    });
  });

  describe("when the caller tries to widen its own scope", () => {
    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("refuses a SETTINGS clause that would rewrite the tenant capability", async () => {
      const body = await refuse(
        openProject,
        `SELECT count() FROM ${database}.traces ` +
          `SETTINGS ${harness.names.tenantSetting} = 'anything'`,
      );
      expect(body.error).toBe("governed_sql_not_permitted");
      expect(
        body.violations.map((violation: any) => violation.code),
      ).toContain("SETTINGS_CLAUSE");
    });

    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("reports another project named in the path as not found", async () => {
      const response = await post(
        openProject,
        { sql: `SELECT count() FROM ${database}.traces` },
        { path: queryPath(gatedProject), token: openProject.apiKey },
      );
      expect(response.status).toBe(404);
      expect(((await response.json()) as any).error).toBe("project_not_found");
    });

    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("ignores a tenant named in the request body", async () => {
      const response = await post(openProject, {
        sql: `SELECT DISTINCT TenantId FROM ${database}.traces`,
        projectId: gatedProject.id,
        tenantId: gatedProject.id,
      });
      const body = (await response.json()) as any;
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.rows.map((row: any) => row.TenantId)).toEqual([
        openProject.id,
      ]);
    });

    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("refuses the physical fact tables the views read", async () => {
      const body = await refuse(
        openProject,
        `SELECT count() FROM ${facts}.trace_summaries`,
      );
      expect(body.error).toBe("governed_sql_not_permitted");
      expect(
        body.violations.map((violation: any) => violation.code),
      ).toContain("TABLE_NOT_ALLOWED");
    });
  });

  describe("when the query reaches for something outside the governed schema", () => {
    /** @scenario "External and table-function access is blocked by AST policy before reaching the database" */
    it("rejects every table function by AST policy, before the database sees it", async () => {
      for (const sql of [
        "SELECT * FROM url('http://example.com/x.csv', CSV, 'a String')",
        "SELECT * FROM s3('https://example.com/x.parquet')",
        "SELECT * FROM remote('example.com:9000', system, one)",
        "SELECT * FROM file('x.csv', CSV, 'a String')",
        "SELECT * FROM postgresql('example.com:5432', 'db', 'annotations', 'u', 'p')",
        "SELECT * FROM numbers(10)",
      ]) {
        const body = await refuse(openProject, sql);
        // The coded refusal is itself the evidence: a rejection by the database
        // arrives as a translated or unknown failure, never as this code.
        expect(body.error, sql).toBe("governed_sql_not_permitted");
        expect(
          body.violations.map((violation: any) => violation.code),
          sql,
        ).toContain("TABLE_FUNCTION");
      }
    });

    /** @scenario "Tenant scope derives exclusively from authenticated server context" */
    it("rejects server metadata schemas", async () => {
      for (const sql of [
        "SELECT * FROM system.users",
        "SELECT * FROM system.settings",
        "SELECT * FROM information_schema.tables",
      ]) {
        const body = await refuse(openProject, sql);
        expect(body.error, sql).toBe("governed_sql_not_permitted");
        expect(
          body.violations.map((violation: any) => violation.code),
          sql,
        ).toContain("SCHEMA_NOT_ALLOWED");
      }
    });

    it("rejects writes, DDL and multiple statements", async () => {
      for (const [sql, expected] of [
        [`INSERT INTO ${database}.traces VALUES (1)`, "STATEMENT_NOT_ALLOWED"],
        [`DROP TABLE ${database}.traces`, "STATEMENT_NOT_ALLOWED"],
        [`CREATE TABLE x (a String) ENGINE = Memory`, "STATEMENT_NOT_ALLOWED"],
        [`SELECT 1; SELECT 2`, "MULTIPLE_STATEMENTS"],
      ] as const) {
        const body = await refuse(openProject, sql);
        expect(body.error, sql).toBe("governed_sql_not_permitted");
        expect(
          body.violations.map((violation: any) => violation.code),
          sql,
        ).toContain(expected);
      }
    });

    it("reports unparseable text as its own failure, not as a policy refusal", async () => {
      const body = await refuse(openProject, "SELECT FROM WHERE )(");
      expect(body.error).toBe("governed_sql_unparseable");
      expect(body.violations[0].code).toBe("PARSE_FAILED");
    });
  });

  describe("when the caller holds no captured-content permission", () => {
    /** @scenario "Content-gated fields are refused in every expression position" */
    it("refuses a gated field the permitted caller reads in the same position", async () => {
      const positions = (db: string) => [
        `SELECT CapturedInput FROM ${db}.traces`,
        `SELECT TraceId FROM ${db}.traces WHERE CapturedInput != ''`,
        `SELECT count() FROM ${db}.traces GROUP BY CapturedInput`,
        `SELECT TraceId FROM ${db}.traces ORDER BY CapturedInput`,
        `SELECT count() FROM ${db}.traces GROUP BY TraceId HAVING max(CapturedInput) != ''`,
        `SELECT t.TraceId FROM ${db}.traces AS t INNER JOIN ${db}.spans AS s ON s.TraceId = t.CapturedInput`,
        `SELECT row_number() OVER (PARTITION BY CapturedInput) FROM ${db}.traces`,
        `SELECT TraceId FROM ${db}.traces WHERE TraceId IN (SELECT CapturedInput FROM ${db}.traces)`,
      ];

      for (const sql of positions(database)) {
        const body = await refuse(gatedProject, sql);
        expect(body.error, sql).toBe("governed_sql_not_permitted");
        expect(
          body.violations.map((violation: any) => violation.code),
          sql,
        ).toContain("GATED_COLUMN");
      }

      // The same queries for a caller who holds the permission, so the
      // refusals are about the gate rather than about the SQL.
      for (const sql of positions(database)) {
        const response = await post(openProject, { sql });
        expect(response.status, sql).toBe(200);
      }
    });

    it("refuses a wildcard for the gated caller and permits it for the whole one", async () => {
      const sql = `SELECT * FROM ${database}.traces LIMIT 1`;
      const refused = await refuse(gatedProject, sql);
      expect(
        refused.violations.map((violation: any) => violation.code),
      ).toContain("WILDCARD_NOT_ALLOWED");

      expect((await post(openProject, { sql })).status).toBe(200);
    });

    it("still answers ungated questions for the gated caller", async () => {
      const body = await run(
        gatedProject,
        `SELECT count() AS value FROM ${database}.traces`,
      );
      expect(Number(body.rows[0].value)).toBeGreaterThan(0);
    });
  });

  describe("when the schema endpoint is called", () => {
    /** @scenario "The schema endpoint names which permission unlocks each gated column" */
    it("names the permission that unlocks each withheld column, per caller", async () => {
      const readSchema = async (project: Project) => {
        const response = await app.request(schemaPath(project), {
          headers: { "X-Auth-Token": project.apiKey },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as any;
      };

      const permitted = await readSchema(openProject);
      const gated = await readSchema(gatedProject);

      expect(permitted.database).toBe(database);
      expect(permitted.datasets.map((dataset: any) => dataset.name)).toEqual(
        GOVERNED_VIEW_CATALOG.map((view) => `${database}.${view.name}`),
      );

      const columnOf = (schema: any, dataset: string, column: string) =>
        schema.datasets
          .find((entry: any) => entry.name === `${database}.${dataset}`)
          .columns.find((entry: any) => entry.name === column);

      // The withheld column is listed, unavailable, and says which permission
      // would unlock it — the whole point of publishing kinds over a boolean.
      const withheld = columnOf(gated, "traces", "CapturedInput");
      expect(withheld.available).toBe(false);
      expect(withheld.gates).toEqual(["input"]);
      expect(columnOf(gated, "traces", "CapturedOutput").gates).toEqual([
        "output",
      ]);
      expect(columnOf(gated, "traces", "TotalCost")).toMatchObject({
        gates: ["costs"],
        available: true,
      });

      expect(columnOf(permitted, "traces", "CapturedInput").available).toBe(
        true,
      );
      expect(
        permitted.datasets.flatMap((dataset: any) =>
          dataset.columns.filter((column: any) => !column.available),
        ),
      ).toEqual([]);
    });

    it("publishes an example query the caller can actually run", async () => {
      const response = await app.request(schemaPath(gatedProject), {
        headers: { "X-Auth-Token": gatedProject.apiKey },
      });
      const schema = (await response.json()) as any;

      for (const dataset of schema.datasets) {
        const result = await post(gatedProject, { sql: dataset.exampleSql });
        expect(result.status, `${dataset.name}: ${dataset.exampleSql}`).toBe(
          200,
        );
      }
    });

    it("reports another project named in the path as not found", async () => {
      const response = await app.request(schemaPath(gatedProject), {
        headers: { "X-Auth-Token": openProject.apiKey },
      });
      expect(response.status).toBe(404);
    });
  });

  describe("when a parameterized query is submitted", () => {
    const parameterized =
      "SELECT TraceId, TotalDurationMs FROM traces " +
      "WHERE TraceName = {name:String} AND TotalDurationMs >= {floor:UInt32} " +
      "ORDER BY TraceId";

    /** @scenario "Parameterized queries re-run deterministically through the REST API" */
    it("returns the identical result when re-run with the same bound values", async () => {
      const parameters = { name: "checkout", floor: 200 };
      const first = await run(openProject, parameterized, parameters);
      const second = await run(openProject, parameterized, parameters);

      expect(
        first.rows.length,
        "the parameterized query matched nothing — identical empty results prove nothing",
      ).toBeGreaterThan(0);
      expect(second.rows).toEqual(first.rows);
      expect(second.columns).toEqual(first.columns);
    });

    it("binds the values rather than ignoring them", async () => {
      const loose = await run(openProject, parameterized, {
        name: "checkout",
        floor: 0,
      });
      const tight = await run(openProject, parameterized, {
        name: "checkout",
        floor: 500,
      });
      expect(tight.rows.length).toBeLessThan(loose.rows.length);
    });

    /** @scenario "A parameterized query missing a bound value is refused before execution" */
    it("refuses before execution when a declared parameter has no value", async () => {
      const response = await post(openProject, {
        sql: parameterized,
        parameters: { name: "checkout" },
      });
      const body = (await response.json()) as any;
      expect(response.status).toBe(400);
      expect(body.error).toBe("governed_sql_parameter_missing");
      expect(body.parameters).toEqual(["floor"]);
    });
  });

  describe("when the result outgrows the response ceiling", () => {
    /**
     * The ceiling value is lowered for this case rather than seeding ten
     * thousand rows: the mechanism is the same code either way, and the claim
     * under test is that overflow is *marked* rather than silently dropped.
     */
    /** @scenario "Truncation diagnostic fires when results are cut off" */
    it("cuts the result at the ceiling and says so, in the body and in a diagnostic", async () => {
      const full = await run(
        openProject,
        `SELECT TraceId FROM ${database}.traces ORDER BY TraceId`,
      );
      expect(full.rows.length).toBeGreaterThan(2);
      expect(full.truncated).toBe(false);

      setGovernedSqlService(
        new GovernedSqlService({
          executor: createGovernedSqlExecutor({
            ...harness.restrictedConnection(),
            database,
            tenantSetting: harness.names.tenantSetting,
          }),
          database,
          limits: { maxRows: 2, maxResultBytes: 8_000_000 },
        }),
      );
      try {
        const capped = await run(
          openProject,
          `SELECT TraceId FROM ${database}.traces ORDER BY TraceId`,
        );
        expect(capped.rows).toHaveLength(2);
        expect(capped.rows).toEqual(full.rows.slice(0, 2));
        expect(capped.truncated).toBe(true);
        expect(capped.statistics.rowsReturned).toBe(2);
        expect(capped.diagnostics.map((entry: any) => entry.code)).toEqual([
          "RESULT_TRUNCATED",
        ]);
      } finally {
        setGovernedSqlService(
          new GovernedSqlService({
            executor: createGovernedSqlExecutor({
              ...harness.restrictedConnection(),
              database,
              tenantSetting: harness.names.tenantSetting,
            }),
            database,
          }),
        );
      }
    });
  });

  describe("when the caller asks the server about its own session", () => {
    /**
     * Characterization, not an endorsement — and the reason the feature file's
     * "Query database credentials never reach the caller" scenario is
     * deliberately left unbound by this suite.
     *
     * The validator allowlists node *kinds*, not function names, so
     * `currentUser()` and `getSetting()` parse, pass the gate, and answer. What
     * they answer is this caller's own session: the shared restricted identity
     * the gateway runs as, and the capability derived from the caller's own
     * project key — nothing of another tenant's, and no credential. So it is
     * not a leak, and it *is* the most direct evidence there is that the
     * gateway executes as the restricted identity with the right capability
     * rather than borrowing the application's own connection.
     *
     * It is still more of the server than this API means to publish. Closing it
     * needs a function allowlist in the validator, which this slice does not
     * own; when one lands, this test is where the change is noticed.
     */
    it("answers as the restricted identity, carrying this caller's own capability", async () => {
      const body = await run(
        openProject,
        `SELECT currentUser() AS identity, ` +
          `getSetting('${harness.names.tenantSetting}') AS capability`,
      );

      expect(
        body.rows[0].identity,
        "the gateway did not execute as the restricted identity",
      ).toBe(harness.names.restrictedUser);
      expect(
        body.rows[0].capability,
        "the gateway sent a capability that is not this caller's",
      ).toBe(governedTenantCapability({ apiKey: openProject.apiKey }));
    });
  });

  describe("when a response or an error is inspected for internals", () => {
    /**
     * Deliberately unbound: this proves responses and errors never *volunteer*
     * an internal, which is narrower than the feature file's scenario, and the
     * gap is named in the characterization above.
     */
    it("never volunteers a credential, a server setting, a physical table name, or another tenant", async () => {
      const connection = harness.restrictedConnection();
      // Every request below is made as the gated project, so the *open*
      // project is the other tenant, and its very existence is one of the
      // things an error must not disclose.
      const secrets = [
        connection.password,
        connection.username,
        connection.url,
        harness.names.tenantSetting,
        governedTenantCapability({ apiKey: gatedProject.apiKey }),
        harness.names.keyMapTable,
        openProject.id,
        openProject.apiKey,
        ...GOVERNED_VIEW_CATALOG.map((view) => view.sourceTable),
        facts,
      ];

      // A mix of answers and refusals: the leak surface is both.
      const responses = await Promise.all(
        [
          `SELECT count() AS value FROM ${database}.traces`,
          `SELECT * FROM ${database}.nowhere`,
          `SELECT CapturedInput FROM ${database}.traces`,
          "SELECT FROM WHERE )(",
          `SELECT count() FROM ${database}.traces SETTINGS max_threads = 1`,
          `DROP TABLE ${database}.traces`,
        ].map((sql) => post(gatedProject, { sql })),
      );
      const bodies = await Promise.all(
        responses.map((response) => response.text()),
      );

      for (const body of bodies) {
        for (const secret of secrets) {
          expect(
            body.includes(secret),
            `a response leaked "${secret}": ${body}`,
          ).toBe(false);
        }
      }
    });
  });

  describe("when the statement the database ran is compared with the one submitted", () => {
    /** @scenario "Submitted SQL is never automatically rewritten" */
    it("executes the submitted statement, with nothing injected into it", async () => {
      const marker = `rewrite_probe_${nanoid(8).replace(/[^a-zA-Z0-9]/g, "")}`;
      const sql = `SELECT count() AS ${marker} FROM ${database}.traces`;
      await run(openProject, sql);

      await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);
      const logged = await selectRows<{ query: string }>(
        harness.admin,
        `SELECT query FROM system.query_log ` +
          `WHERE type = 'QueryFinish' AND user = '${harness.names.restrictedUser}' ` +
          `AND positionCaseInsensitive(query, '${marker}') > 0`,
      );

      expect(
        logged.length,
        "the probe query is not in the server's log — the comparison below would be vacuous",
      ).toBe(1);
      expect(
        logged[0]!.query.includes(sql),
        `the database ran a different statement:\n${logged[0]!.query}`,
      ).toBe(true);
      // Nothing was added inside the statement: the only thing the transport
      // appends is the FORMAT the driver needs to read the response back.
      expect(logged[0]!.query.replace(sql, "").trim()).toBe("FORMAT JSON");
    });
  });

  describe("when a PostgreSQL SQL endpoint is looked for", () => {
    /** @scenario "No PostgreSQL native-SQL execution endpoint exists" */
    it("finds none", async () => {
      for (const path of [
        `/api/v1/projects/${openProject.id}/analytics/query/postgres`,
        `/api/v1/projects/${openProject.id}/analytics/query/postgresql`,
      ]) {
        const response = await post(
          openProject,
          { sql: "SELECT 1" },
          { path },
        );
        expect(response.status, path).toBe(404);
      }
    });
  });
});

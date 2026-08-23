/**
 * The LangWatchQL analytics SQL endpoints, driven through the real HTTP app.
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
 * @see specs/analytics/lwql-api.feature
 * @see ~/server/analytics/lwql — the service under test
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import {
  createLangWatchQLExecutor,
  LangWatchQLService,
  lwqlTenantCapability,
  setLangWatchQLService,
} from "~/server/analytics/lwql";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  mapPostgresIntoClickHouse,
  postgresTenantSeedStatements,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "~/server/analytics/lwql/__tests__/lwqlClickHouseHarness";
import { LWQL_VIEW_CATALOG } from "~/server/analytics/lwql/catalog/lwqlViews";
import {
  isPostgresResident,
  type LangWatchQLViewDefinition,
} from "~/server/analytics/lwql/catalog/types";
import {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "~/server/analytics/lwql/views";
import { getProtectionsForProject } from "~/server/api/utils";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { prisma } from "~/server/db";
import { getFeatureFlagStore } from "~/server/featureFlag";
import { pinTimezone } from "~/test-utils/pinTimezone";
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
 * Seeds one tenant across every LangWatchQL dataset.
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

  // The analytics projections and their rollups: the same traces and
  // evaluations again, folded the way the analytics path folds them.
  await admin.insert({
    table: `${database}.trace_analytics`,
    format: "JSONEachRow",
    values: traceIds.map((traceId, index) => ({
      TenantId: tenantId,
      TraceId: traceId,
      Version: "1",
      OccurredAt: SEED_AT,
      CreatedAt: SEED_AT,
      UpdatedAt: SEED_AT,
      TraceName: "checkout",
      TopicId: "checkout",
      UserId: `${tenantId}-end-user`,
      ConversationId: `${tenantId}-thread`,
      CustomerId: `${tenantId}-customer`,
      Origin: "sdk",
      Models: ["gpt-5-mini"],
      Labels: ["checkout"],
      TotalCost: 0.0042,
      NonBilledCost: 0.0001,
      TotalDurationMs: 100 * (index + 1),
      TimeToFirstTokenMs: 120,
      TokensPerSecond: 42,
      PromptTokens: 100,
      CompletionTokens: 20,
      CacheReadTokens: 5,
      CacheWriteTokens: 3,
      ReasoningTokens: 7,
      HasError: false,
      Attributes: {
        "gen_ai.request.model": "gpt-5-mini",
        "gen_ai.prompt": `${marks.spanInput}-prompt`,
      },
    })),
  });

  await admin.insert({
    table: `${database}.evaluation_analytics`,
    format: "JSONEachRow",
    values: [...Array(SEEDED_EVALUATIONS).keys()].map((index) => ({
      TenantId: tenantId,
      EvaluationId: `${tenantId}-eval-${index}`,
      Version: "1",
      OccurredAt: SEED_AT,
      CreatedAt: SEED_AT,
      UpdatedAt: SEED_AT,
      EvaluatorType: "llm_judge",
      EvaluatorName: "Quality",
      Status: "processed",
      IsGuardrail: false,
      Passed: index % 2 === 0,
      Score: 0.5 + index / 10,
      Label: "good",
      Model: "gpt-5-mini",
      TraceId: traceIds[index % traceIds.length],
      UserId: `${tenantId}-end-user`,
      ConversationId: `${tenantId}-thread`,
      CustomerId: `${tenantId}-customer`,
      Origin: "sdk",
      DurationMs: 340,
      TotalCost: 0.0009,
      NonBilledCost: 0,
      Attributes: {
        "gen_ai.request.model": "gpt-5-mini",
        "gen_ai.prompt": `${marks.spanInput}-prompt`,
      },
    })),
  });

  await admin.insert({
    table: `${database}.trace_analytics_rollup`,
    format: "JSONEachRow",
    values: [
      {
        TenantId: tenantId,
        BucketStart: SEED_AT,
        Model: "gpt-5-mini",
        SpanType: "llm",
        SpanCount: SEEDED_TRACES,
        TraceCount: SEEDED_TRACES,
        ErrorCount: 0,
        CostSum: 0.0042 * SEEDED_TRACES,
        NonBilledCostSum: 0.0001 * SEEDED_TRACES,
        // The sum of `100 * (index + 1)` over the seeded traces above.
        DurationSum: 2100,
        PromptTokensSum: 100 * SEEDED_TRACES,
        CompletionTokensSum: 20 * SEEDED_TRACES,
        CacheReadTokensSum: 5 * SEEDED_TRACES,
        CacheWriteTokensSum: 3 * SEEDED_TRACES,
        ReasoningTokensSum: 7 * SEEDED_TRACES,
      },
    ],
  });

  await admin.insert({
    table: `${database}.evaluation_analytics_rollup`,
    format: "JSONEachRow",
    values: [
      {
        TenantId: tenantId,
        BucketStart: SEED_AT,
        EvaluatorType: "llm_judge",
        Status: "processed",
        EvalCount: SEEDED_EVALUATIONS,
        // The seeds above pass on even indices: half pass, half fail.
        PassCount: SEEDED_EVALUATIONS / 2,
        FailCount: SEEDED_EVALUATIONS / 2,
        ErrorCount: 0,
        SkippedCount: 0,
        // The sum of `0.5 + index / 10` over the seeded evaluations above.
        ScoreSum: 2.6,
        ScoreCount: SEEDED_EVALUATIONS,
        DurationSum: 340 * SEEDED_EVALUATIONS,
        CostSum: 0.0009 * SEEDED_EVALUATIONS,
        NonBilledCostSum: 0,
      },
    ],
  });
}

describe("given the LangWatchQL analytics SQL REST endpoints", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
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
    expect(response.status, `query failed: ${JSON.stringify(body)}`).toBe(200);
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

  /** Reads the schema endpoint as one project, asserting it answered. */
  const readSchema = async (project: Project) => {
    const response = await app.request(schemaPath(project), {
      headers: { "X-Auth-Token": project.apiKey },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, any>;
  };

  /**
   * Puts the process-wide service back to what a deployment would build.
   *
   * Two cases swap it for one with a different ceiling or a different catalog,
   * and a swap left in place would silently become the configuration every
   * later case ran against.
   */
  const restoreShippedService = () => {
    setLangWatchQLService(
      new LangWatchQLService({
        executor: createLangWatchQLExecutor({
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        }),
        database,
      }),
    );
  };

  /** Rows one tenant holds in a named fact table, read as the administrator. */
  const adminRowCount = async (table: string, tenantId: string) => {
    const [row] = await selectRows<{ value: string }>(
      harness.admin,
      `SELECT count() AS value FROM ${facts}.${table} WHERE TenantId = '${tenantId}'`,
    );
    return Number(row!.value);
  };

  /**
   * The same, for a dataset's source table, with the database taken from the
   * catalog rather than assumed: a PostgreSQL-engine table sits beside the
   * LangWatchQL views, not with the migrated fact tables.
   */
  const adminSourceRowCount = async (
    view: LangWatchQLViewDefinition,
    tenantId: string,
  ) => {
    const [row] = await selectRows<{ value: string }>(
      harness.admin,
      `SELECT count() AS value FROM ${isPostgresResident(view) ? database : facts}.${view.sourceTable} ` +
        `WHERE TenantId = '${tenantId}'`,
    );
    return Number(row!.value);
  };

  beforeAll(async () => {
    // The surface ships behind the experimental feature switch, off by
    // default. The suite runs with it on via the flag's own env override —
    // the same lever a deployment uses — and the flag-off cases below unset
    // it for exactly one request.
    process.env.RELEASE_LWQL_WORKBENCH = "1";

    // The catalog spans both residences; the LangWatchQL views over the
    // PostgreSQL-resident half read engine tables that must exist first.
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "restapi",
      facts: "migrated",
    });
    database = harness.names.database;
    facts = harness.factDatabase;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      lwqlViewSetupStatements({
        names: harness.names,
        sourceDatabase: facts,
        dedup: SHIPPED_LWQL_DEDUP,
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
      data: { name: "LangWatchQL Org", slug: `lwql-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "LangWatchQL Team",
        slug: `lwql-${nanoid()}`,
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
        KeyHash: lwqlTenantCapability({ secret: project.lwqlKey }),
        TenantId: project.id,
      })),
    });

    for (const project of [openProject, gatedProject]) {
      await seedTenant({
        admin: harness.admin,
        database: facts,
        tenantId: project.id,
      });
      // The PostgreSQL-resident half, under the same project ids: a LangWatchQL
      // view a caller can name but has no rows in would make every "reads its
      // own tenant's rows" case below vacuous for that dataset.
      for (const statement of postgresTenantSeedStatements({
        tenantId: project.id,
      })) {
        const result = await postgres.asAdmin(statement);
        expect(result.exitCode, result.stderr).toBe(0);
      }
    }

    setLangWatchQLService(
      new LangWatchQLService({
        executor: createLangWatchQLExecutor({
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        }),
        database,
      }),
    );
  }, 600_000);

  afterAll(async () => {
    delete process.env.RELEASE_LWQL_WORKBENCH;
    setLangWatchQLService(null);
    // Guarded on the identifier each statement actually uses: `team` gates
    // everything keyed by teamId (and the policy created after it), while
    // `organization.delete` gets its own guard so a team-creation failure
    // never leaves the organization behind — and never turns an undefined
    // teamId into a `deleteMany` that matches every project in the database.
    if (team) {
      await prisma.dataPrivacyPolicy.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.project.deleteMany({ where: { teamId: team.id } });
      await prisma.team.delete({ where: { id: team.id } });
    }
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the LangWatchQL feature switch is off for the project", () => {
    /** Runs one request with the switch off, whatever else the suite set. */
    const withFlagOff = async <T>(request: () => Promise<T>): Promise<T> => {
      process.env.RELEASE_LWQL_WORKBENCH = "0";
      try {
        return await request();
      } finally {
        process.env.RELEASE_LWQL_WORKBENCH = "1";
      }
    };

    /** @scenario "The whole surface stays dark until the experimental feature switch is on" */
    it("refuses the query endpoint with the named refusal and touches no data", async () => {
      const response = await withFlagOff(async () =>
        post(openProject, { sql: "SELECT 1" }),
      );
      const body = (await response.json()) as Record<string, any>;
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("lwql_not_enabled");
    });

    /** @scenario "The whole surface stays dark until the experimental feature switch is on" */
    it("refuses the schema endpoint the same way", async () => {
      const response = await withFlagOff(async () =>
        app.request(schemaPath(openProject), {
          headers: { "X-Auth-Token": openProject.apiKey },
        }),
      );
      const body = (await response.json()) as Record<string, any>;
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("lwql_not_enabled");
    });
  });

  describe("when a stored organization rule is the only thing enabling the switch", () => {
    /**
     * No environment override, a row whose default is off, and one rule keyed
     * to an organization: the surface is on exactly for that organization's
     * projects. Runs against the real store, so this is the whole chain —
     * gate resolves the project's organization, rule matches it.
     */
    const withOrganizationRule = async <T>(
      organizationId: string,
      request: () => Promise<T>,
    ): Promise<T> => {
      const store = getFeatureFlagStore();
      await store.setRules(
        "release_lwql_workbench",
        [{ match: { organizationId }, enabled: true }],
        null,
      );
      // Both env doors must be shut or the rule is never consulted: the
      // dev .env force-enables this flag, and force-enable wins before the
      // store — leaving it in place turns both of these tests vacuous.
      const forceEnable = process.env.FEATURE_FLAG_FORCE_ENABLE;
      delete process.env.RELEASE_LWQL_WORKBENCH;
      delete process.env.FEATURE_FLAG_FORCE_ENABLE;
      try {
        return await request();
      } finally {
        process.env.RELEASE_LWQL_WORKBENCH = "1";
        if (forceEnable !== undefined) {
          process.env.FEATURE_FLAG_FORCE_ENABLE = forceEnable;
        }
        await store.clear("release_lwql_workbench", null);
      }
    };

    /** @scenario "An organization-scoped rule can switch the workbench on" */
    it("turns the surface on for that organization's projects", async () => {
      const response = await withOrganizationRule(organization.id, async () =>
        app.request(schemaPath(openProject), {
          headers: { "X-Auth-Token": openProject.apiKey },
        }),
      );
      expect(response.status).toBe(200);
    });

    /** @scenario "An organization-scoped rule can switch the workbench on" */
    it("leaves the surface off for a project outside the rule's organization", async () => {
      const response = await withOrganizationRule(
        "org_someone_else",
        async () =>
          app.request(schemaPath(openProject), {
            headers: { "X-Auth-Token": openProject.apiKey },
          }),
      );
      const body = (await response.json()) as Record<string, any>;
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("lwql_not_enabled");
    });
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
        `SELECT TraceId, TotalDurationMs FROM ${database}.traces ` +
          // Bounded on the partition-pruning column, so the empty diagnostics
          // list below is a clean answer rather than a rule that is switched
          // off — an unbounded read of the same dataset earns a diagnostic.
          `WHERE OccurredAt >= toDateTime64('${SEED_WINDOW.from}', 3) ` +
          `ORDER BY TraceId LIMIT 3`,
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

    /** @scenario "A LangWatchQL view returns only the calling tenant's rows" */
    it("reads every LangWatchQL view, seeing exactly its own tenant's rows", async () => {
      for (const view of LWQL_VIEW_CATALOG) {
        const expected = await adminSourceRowCount(view, openProject.id);
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

    /** @scenario "A LangWatchQL view returns one row per logical record, the latest version" */
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

    it("resolves an unqualified dataset name to the LangWatchQL database", async () => {
      const body = await run(
        openProject,
        "SELECT count() AS value FROM traces",
      );
      expect(Number(body.rows[0].value)).toBeGreaterThan(0);
    });
  });

  /**
   * The reserved time-window parameters, against the real server.
   *
   * The format is pinned as a unit property; what only a database can answer is
   * whether ClickHouse *accepts* the literal we inject and bounds the read the
   * way the contract says it does. Both are asked here.
   *
   * The process zone is pinned away from UTC for the length of this group: with
   * `TZ` unset — which is most runners — an implementation formatting the
   * window with the *local* getters would agree with the correct one on every
   * instant, and every count below would be green either way.
   */
  describe("when the surface supplies the reserved time window", () => {
    pinTimezone("America/Sao_Paulo");

    /** Every seeded trace shares this instant. */
    const SEEDED_AT = new Date(`${SEED_AT.replace(" ", "T")}Z`);
    const second = (offset: number) =>
      new Date(SEEDED_AT.getTime() + offset * 1000);

    const PERIOD_SQL = () =>
      `SELECT count() AS value FROM ${database}.traces ` +
      `WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}`;

    /** Rows a period-aware statement returns for one window. */
    const countFor = async (timeWindow: { start: Date; end: Date }) => {
      const response = await post(openProject, {
        sql: PERIOD_SQL(),
        timeWindow,
      });
      const body = (await response.json()) as Record<string, any>;
      expect(response.status, `query failed: ${JSON.stringify(body)}`).toBe(
        200,
      );
      expect(body.followsTimeWindow).toBe(true);
      return Number(body.rows[0].value);
    };

    /**
     * The same minute, bounded with literals instead of the reserved names.
     *
     * A control rather than a constant: it is what the injected window has to
     * agree with, and asserting it is non-zero first is what stops "the two
     * agree" from being two zeroes agreeing.
     */
    const literalBaseline = async () => {
      const body = await run(
        openProject,
        `SELECT count() AS value FROM ${database}.traces ` +
          `WHERE OccurredAt >= toDateTime64('2026-02-20 11:59:00', 3) ` +
          `AND OccurredAt < toDateTime64('2026-02-20 12:01:00', 3)`,
      );
      const count = Number(body.rows[0].value);
      expect(
        count,
        "nothing is seeded in the window under test",
      ).toBeGreaterThan(0);
      return count;
    };

    /** @scenario "The window the surface sends is the window the database reads" */
    it("returns the rows inside the window and none outside it", async () => {
      const expected = await literalBaseline();

      expect(await countFor({ start: second(-60), end: second(60) })).toBe(
        expected,
      );

      // An hour and a half later. Under a local-time bug this window would
      // still bracket the seeded instant, because the pinned zone is three
      // hours behind UTC — so a non-zero answer here names that bug.
      expect(await countFor({ start: second(5400), end: second(9000) })).toBe(
        0,
      );
    });

    /** @scenario "The period is half-open, so the start instant is included and the end instant is not" */
    it("includes a row sitting exactly on the start and excludes one on the end", async () => {
      const expected = await literalBaseline();

      expect(await countFor({ start: SEEDED_AT, end: second(1) })).toBe(
        expected,
      );
      expect(await countFor({ start: second(-1), end: SEEDED_AT })).toBe(0);
    });

    /** @scenario "A caller that supplies a reserved period parameter itself is refused" */
    it("refuses a request that pins the window under its own parameters", async () => {
      const response = await post(openProject, {
        sql: PERIOD_SQL(),
        parameters: { period_start: "2020-01-01 00:00:00" },
        timeWindow: { start: second(-60), end: second(60) },
      });
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("lwql_reserved_parameter_supplied");
    });

    /** @scenario "A statement with no period parameters runs, and says so" */
    it("runs a statement that declares neither, and reports that it does not follow the period", async () => {
      const body = await run(
        openProject,
        `SELECT count() AS value FROM ${database}.traces ` +
          `WHERE OccurredAt >= toDateTime64('${SEED_WINDOW.from}', 3)`,
      );

      expect(Number(body.rows[0].value)).toBeGreaterThan(0);
      expect(body.followsTimeWindow).toBe(false);
    });
  });

  describe("when two tenants have rows", () => {
    /** @scenario "A LangWatchQL view returns only the calling tenant's rows" */
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
      expect(body.error.code).toBe("lwql_not_permitted");
      expect(
        body.error.meta.violations.map((violation: any) => violation.code),
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
      expect(((await response.json()) as any).error.code).toBe(
        "project_not_found",
      );
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
      expect(body.error.code).toBe("lwql_not_permitted");
      expect(
        body.error.meta.violations.map((violation: any) => violation.code),
      ).toContain("TABLE_NOT_ALLOWED");
    });
  });

  describe("when the query reaches for something outside the LangWatchQL schema", () => {
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
        expect(body.error.code, sql).toBe("lwql_not_permitted");
        expect(
          body.error.meta.violations.map((violation: any) => violation.code),
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
        expect(body.error.code, sql).toBe("lwql_not_permitted");
        expect(
          body.error.meta.violations.map((violation: any) => violation.code),
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
        expect(body.error.code, sql).toBe("lwql_not_permitted");
        expect(
          body.error.meta.violations.map((violation: any) => violation.code),
          sql,
        ).toContain(expected);
      }
    });

    it("reports unparseable text as its own failure, not as a policy refusal", async () => {
      const body = await refuse(openProject, "SELECT FROM WHERE )(");
      expect(body.error.code).toBe("lwql_unparseable");
      expect(body.error.meta.violations[0].code).toBe("PARSE_FAILED");
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
        expect(body.error.code, sql).toBe("lwql_not_permitted");
        expect(
          body.error.meta.violations.map((violation: any) => violation.code),
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
        refused.error.meta.violations.map((violation: any) => violation.code),
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
      const permitted = await readSchema(openProject);
      const gated = await readSchema(gatedProject);

      expect(permitted.database).toBe(database);
      expect(permitted.datasets.map((dataset: any) => dataset.name)).toEqual(
        LWQL_VIEW_CATALOG.map((view) => `${database}.${view.name}`),
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

    /** @scenario "Authenticated client discovers its LangWatchQL schema scoped to its own permissions" */
    it("describes every dataset it publishes, down to what its numbers are measured in", async () => {
      for (const project of [openProject, gatedProject]) {
        const schema = await readSchema(project);

        expect(schema.datasets.length).toBeGreaterThan(0);
        for (const dataset of schema.datasets) {
          const where = `${project.slug}: ${dataset.name}`;
          expect(dataset.description, where).not.toBe("");
          expect(dataset.grain, where).not.toBe("");
          expect(dataset.freshness, where).not.toBe("");
          expect(dataset.timeColumn, where).not.toBe("");
          expect(dataset.joinKeys.length, where).toBeGreaterThan(0);
          expect(dataset.exampleSql, where).toContain(dataset.name);

          for (const column of dataset.columns) {
            const at = `${where}.${column.name}`;
            expect(column.type, at).not.toBe("");
            expect(column.description, at).not.toBe("");
            // The content restrictions, per column: which permissions it needs
            // and whether this caller holds them.
            expect(Array.isArray(column.gates), at).toBe(true);
            expect(typeof column.available, at).toBe("boolean");
            // Units are answered for every column, `null` where there is none.
            expect(Object.hasOwn(column, "unit"), at).toBe(true);
          }
        }

        const units = schema.datasets.flatMap((dataset: any) =>
          dataset.columns
            .filter((column: any) => column.unit !== null)
            .map((column: any) => column.unit),
        );
        expect(
          new Set(units),
          "no column published a unit — the assertion above passes on all-null",
        ).toContain("ms");
        expect(new Set(units)).toContain("USD");
      }
    });

    /**
     * A dataset the caller may read nothing in. Driven with a catalog that has
     * one, because the shipped catalog gates no dataset as a whole — a case
     * written against it would be asserting that nothing happens, which is not
     * what the scenario claims. The endpoint, the auth path and the permission
     * derivation under test are the shipped ones.
     */
    /** @scenario "Authenticated client discovers its LangWatchQL schema scoped to its own permissions" */
    it("leaves out a dataset the caller's permissions do not reach", async () => {
      const transcripts: LangWatchQLViewDefinition = {
        name: "transcripts",
        sourceTable: "raw_transcripts",
        description: "Everything said in a conversation, verbatim.",
        gates: ["input"],
        grain: "one row per (TenantId, TranscriptId)",
        joinKeys: ["TenantId"],
        timeColumn: "OccurredAt",
        freshness: "seconds behind ingestion",
        dedup: { keyColumns: ["TenantId"], versionColumn: "UpdatedAt" },
        columns: [
          {
            name: "TranscriptId",
            type: "String",
            description: "Transcript identifier.",
            gates: [],
            sourceColumns: ["TranscriptId"],
          },
        ],
      };

      setLangWatchQLService(
        new LangWatchQLService({
          executor: createLangWatchQLExecutor({
            ...harness.restrictedConnection(),
            database,
            tenantSetting: harness.names.tenantSetting,
          }),
          database,
          views: [...LWQL_VIEW_CATALOG, transcripts],
        }),
      );
      try {
        const names = async (project: Project) =>
          (await readSchema(project)).datasets.map(
            (dataset: any) => dataset.name,
          );

        // The gated project's data-privacy rule withholds captured input, so
        // the dataset that needs it is not there at all.
        expect(await names(gatedProject)).not.toContain(
          `${database}.transcripts`,
        );
        // The same catalog, a caller who holds the permission: present. Absence
        // is about the permission and not about the fixture.
        expect(await names(openProject)).toContain(`${database}.transcripts`);
      } finally {
        restoreShippedService();
      }
    });

    /**
     * Absent from the published schema is not the same as out of reach. The
     * validator's `allowedTables` is what makes it the second thing, and it is
     * the half a caller who reads no documentation would find.
     */
    /** @scenario "A dataset withheld from a caller cannot be named in a query" */
    it("refuses a query naming a dataset the caller's permissions withhold, and answers it for one who holds them", async () => {
      const transcripts: LangWatchQLViewDefinition = {
        name: "transcripts",
        // Pointed at a table the migrations really created, so the permitted
        // caller's query below reaches the database rather than failing on a
        // missing relation — which would make the two halves fail for
        // different reasons and prove neither.
        sourceTable: "trace_summaries",
        description: "Everything said in a conversation, verbatim.",
        gates: ["input"],
        grain: "one row per (TenantId, TraceId)",
        joinKeys: ["TenantId"],
        timeColumn: "OccurredAt",
        freshness: "seconds behind ingestion",
        dedup: {
          keyColumns: ["TenantId", "TraceId"],
          versionColumn: "UpdatedAt",
        },
        columns: [
          {
            name: "TraceId",
            type: "String",
            description: "Trace identifier.",
            gates: [],
            sourceColumns: ["TraceId"],
          },
          {
            name: "OccurredAt",
            type: "DateTime64(3)",
            description: "When the conversation started.",
            gates: [],
            sourceColumns: ["OccurredAt"],
          },
        ],
      };
      const views = [...LWQL_VIEW_CATALOG, transcripts];

      await harness.applyAsAdmin(
        lwqlViewSetupStatements({
          names: harness.names,
          sourceDatabase: facts,
          views: [transcripts],
          dedup: SHIPPED_LWQL_DEDUP,
        }),
      );
      setLangWatchQLService(
        new LangWatchQLService({
          executor: createLangWatchQLExecutor({
            ...harness.restrictedConnection(),
            database,
            tenantSetting: harness.names.tenantSetting,
          }),
          database,
          views,
        }),
      );
      try {
        const sql = `SELECT count() AS value FROM ${database}.transcripts`;

        const refused = await refuse(gatedProject, sql);
        expect(refused.error.code).toBe("lwql_not_permitted");
        expect(
          refused.error.meta.violations.map((violation: any) => violation.code),
        ).toContain("TABLE_NOT_ALLOWED");

        // The permitted caller reads it, which is what proves the refusal was
        // the permission rather than a dataset that does not work.
        const answered = await run(openProject, sql);
        expect(Number(answered.rows[0].value)).toBeGreaterThan(0);
      } finally {
        restoreShippedService();
        await harness.applyAsAdmin([
          `DROP VIEW IF EXISTS ${database}.transcripts`,
        ]);
      }
    });

    /**
     * Whether the fail-closed derivation in `lwqlGatedColumns` — which
     * withholds unless a permission is explicitly `true` — can be exercised end
     * to end, settled here rather than re-argued.
     *
     * It cannot be reached with *unresolved* permissions:
     * `getUserProtectionsForProject` assigns an explicit boolean to
     * `canSeeCapturedInput` and `canSeeCapturedOutput` on every one of its
     * return paths, including the `catch` that runs when the policy resolver is
     * down (which returns explicit `false`), and `getProtectionsForProject`
     * pins `canSeeCosts: true` for every API key. So on this path
     * `=== true` and `!== false` are the same test, which is why inverting the
     * check survives this suite. The `=== true` form is still the correct one,
     * because the fields are optional and the service takes `Protections` from
     * callers that are not this route — and that is where the unit suite pins
     * it (`catalog/__tests__/lwqlViewCatalog.unit.test.ts`).
     *
     * The two cases below are the guard on that reasoning: the shape claim, and
     * the resolver outage the claim leans on.
     */
    it("resolves an explicit answer for every permission, never an unresolved one", async () => {
      for (const project of [openProject, gatedProject]) {
        const protections = await getProtectionsForProject(prisma, {
          projectId: project.id,
        });
        expect(
          typeof protections.canSeeCapturedInput,
          `${project.slug} resolved an unresolved input permission`,
        ).toBe("boolean");
        expect(
          typeof protections.canSeeCapturedOutput,
          `${project.slug} resolved an unresolved output permission`,
        ).toBe("boolean");
        expect(protections.canSeeCosts).toBe(true);
      }
    });

    it("withholds content end to end when the policy resolver is down", async () => {
      const service = getDataPrivacyPolicyService();
      const outage = vi
        .spyOn(service, "getResolvedForProject")
        .mockRejectedValue(new Error("policy store unreachable"));
      try {
        const schema = await readSchema(openProject);
        const contentColumns = schema.datasets.flatMap((dataset: any) =>
          dataset.columns.filter(
            (column: any) =>
              column.gates.includes("input") || column.gates.includes("output"),
          ),
        );
        expect(
          contentColumns.length,
          "no column is content-gated — this case is inspecting nothing",
        ).toBeGreaterThan(0);
        for (const column of contentColumns) {
          expect(
            column.available,
            `${column.name} stayed readable through a resolver outage`,
          ).toBe(false);
        }

        const refused = await refuse(
          openProject,
          `SELECT CapturedInput FROM ${database}.traces`,
        );
        expect(
          refused.error.meta.violations.map((violation: any) => violation.code),
        ).toContain("GATED_COLUMN");
      } finally {
        outage.mockRestore();
      }
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
      expect(body.error.code).toBe("lwql_parameter_missing");
      expect(body.error.meta.parameters).toEqual(["floor"]);
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
      // Bounded on the time column, so the only diagnostic either run can earn
      // is the truncation one this case is about.
      const traceIds =
        `SELECT TraceId FROM ${database}.traces ` +
        `WHERE OccurredAt >= toDateTime64('${SEED_WINDOW.from}', 3) ` +
        `ORDER BY TraceId`;
      const full = await run(openProject, traceIds);
      expect(full.rows.length).toBeGreaterThan(2);
      expect(full.truncated).toBe(false);

      setLangWatchQLService(
        new LangWatchQLService({
          executor: createLangWatchQLExecutor({
            ...harness.restrictedConnection(),
            database,
            tenantSetting: harness.names.tenantSetting,
          }),
          database,
          limits: { maxRows: 2, maxResultBytes: 8_000_000 },
        }),
      );
      try {
        const capped = await run(openProject, traceIds);
        expect(capped.rows).toHaveLength(2);
        expect(capped.rows).toEqual(full.rows.slice(0, 2));
        expect(capped.truncated).toBe(true);
        expect(capped.statistics.rowsReturned).toBe(2);
        expect(capped.diagnostics.map((entry: any) => entry.code)).toEqual([
          "RESULT_TRUNCATED",
        ]);
      } finally {
        restoreShippedService();
      }
    });
  });

  describe("when the caller asks the server about its own session", () => {
    /**
     * The inversion of what this suite used to record.
     *
     * Until the validator allowlisted function *names*, `currentUser()` and
     * `getSetting()` parsed, passed the gate, and answered. What they answered
     * was this caller's own session — the shared restricted identity and a
     * capability derived from the caller's own project key — so nothing of
     * another tenant's and no credential. It was still more of the server than
     * this API publishes, and while it was reachable the feature file's
     * "Query database credentials never reach the caller" scenario could not
     * honestly be bound. It is refused now, and the scenario is bound below.
     *
     * The evidence the old test carried — that the gateway really does execute
     * as the restricted identity with this caller's capability — has not been
     * dropped. It moved one layer down, to the positive control in that
     * scenario, which puts the same two questions to the database directly.
     */
    const SESSION_PROBES: readonly [string, (setting: string) => string][] = [
      ["the identity queries run as", () => "currentUser()"],
      [
        "the tenant capability the gateway sends",
        (setting) => `getSetting('${setting}')`,
      ],
      ["the machine the server runs on", () => "hostName()"],
      ["the server build", () => "version()"],
      ["the database the connection is bound to", () => "currentDatabase()"],
    ];

    it.each(
      SESSION_PROBES,
    )("refuses a query asking for %s", async (_case, call) => {
      const body = await refuse(
        openProject,
        `SELECT ${call(harness.names.tenantSetting)} AS value FROM ${database}.traces`,
      );

      expect(body.error.code).toBe("lwql_not_permitted");
      expect(
        body.error.meta.violations.map((violation: any) => violation.code),
      ).toEqual(["FUNCTION_NOT_ALLOWED"]);
    });

    it("still answers the same query shape with a function it does support", async () => {
      const body = await run(
        openProject,
        `SELECT now() AS value FROM ${database}.traces LIMIT 1`,
      );
      expect(body.rows).toHaveLength(1);
    });
  });

  describe("when a response or an error is inspected for internals", () => {
    /**
     * The two directions the scenario names, and a control for each.
     *
     * *Volunteered*: a mix of answers and refusals, none of which mentions an
     * internal in the SQL that produced it, checked against every internal this
     * deployment has. *Asked for*: the same internals requested outright —
     * through a function, through the system schema, through the physical
     * table — and refused.
     *
     * Absence assertions pass against a server that never held the value, so
     * each direction opens with a control that produces it. The session
     * internals are read back as the restricted identity, which is the identity
     * the gateway itself runs as; the database's own error text is captured by
     * running the failing statement there directly. Both are then asserted
     * absent from everything the gateway returned.
     */
    /** @scenario "Query database credentials never reach the caller" */
    it("never carries a credential, a server setting, a physical table name, or another tenant — volunteered or asked for", async () => {
      const connection = harness.restrictedConnection();
      // Every request below is made as the gated project, so the *open*
      // project is the other tenant, and its very existence is one of the
      // things an error must not disclose.
      const capability = lwqlTenantCapability({
        secret: gatedProject.lwqlKey,
      });

      // Control, one layer down: the session facts asserted absent below are
      // exactly what the database answers when the same two questions are put
      // to it directly, as the identity the gateway runs as.
      const restricted = await harness.restrictedClient({
        keyHash: capability,
      });
      expect(
        await selectScalar<string>(restricted, "SELECT currentUser() AS value"),
        "the gateway does not run as the identity these assertions name",
      ).toBe(harness.names.restrictedUser);
      expect(
        await selectScalar<string>(
          restricted,
          `SELECT getSetting('${harness.names.tenantSetting}') AS value`,
        ),
        "the capability these assertions name is not the one the database sees",
      ).toBe(capability);

      // Control for the database's own voice: a statement the gate accepts and
      // ClickHouse then refuses. Its message is what an unfiltered error path
      // would relay, so it is captured here and asserted absent below.
      const failing = `SELECT CAST(TraceName AS UInt64) AS value FROM ${database}.traces`;
      const databaseError = await selectScalar<string>(
        restricted,
        failing,
      ).then(
        () => "",
        (error: unknown) => String((error as Error)?.message ?? ""),
      );
      expect(
        databaseError,
        "the statement meant to fail inside the database succeeded — the control below is vacuous",
      ).not.toBe("");
      // Fragments of the database's own diagnostic, taken from the message it
      // just produced rather than guessed at. `__table1` is the alias
      // ClickHouse gives the view internally, and appears nowhere a caller
      // could have written — so finding either of these in a response could
      // only mean the database's words were relayed verbatim.
      const relayed = ["__table1", "while executing"].filter((fragment) =>
        databaseError.includes(fragment),
      );
      expect(
        relayed,
        `the database error carries none of the fragments asserted absent: ${databaseError}`,
      ).not.toEqual([]);

      const secrets = [
        connection.password,
        connection.username,
        connection.url,
        harness.names.tenantSetting,
        harness.names.settingsProfile,
        capability,
        harness.names.keyMapTable,
        openProject.id,
        openProject.apiKey,
        openProject.lwqlKey,
        ...LWQL_VIEW_CATALOG.map((view) => view.sourceTable),
        facts,
        ...relayed,
      ];

      const probes: readonly {
        sql: string;
        answered: boolean;
        parameters?: Record<string, unknown>;
      }[] = [
        // Volunteered: ordinary answers and ordinary refusals.
        {
          sql: `SELECT count() AS value FROM ${database}.traces`,
          answered: true,
        },
        { sql: `SELECT * FROM ${database}.nowhere`, answered: false },
        {
          sql: `SELECT CapturedInput FROM ${database}.traces`,
          answered: false,
        },
        { sql: "SELECT FROM WHERE )(", answered: false },
        {
          sql: `SELECT count() FROM ${database}.traces SETTINGS max_threads = 1`,
          answered: false,
        },
        { sql: `DROP TABLE ${database}.traces`, answered: false },
        // A statement the gate accepts and the database refuses: the one path
        // where the error the caller sees originates below the gateway.
        { sql: failing, answered: false },
        // Asked for outright.
        {
          sql: `SELECT currentUser() AS value FROM ${database}.traces`,
          answered: false,
        },
        {
          sql: `SELECT hostName() AS value FROM ${database}.traces`,
          answered: false,
        },
        { sql: "SELECT name, value FROM system.settings", answered: false },
        {
          sql: `SELECT name FROM system.tables WHERE database = '${database}'`,
          answered: false,
        },
        // Another tenant's existence, asked for by id. It runs — and the row
        // policy is what makes the answer empty rather than the gate.
        {
          sql: `SELECT count() AS value FROM ${database}.traces WHERE TenantId = {tenant:String}`,
          answered: true,
          parameters: { tenant: openProject.id },
        },
      ];

      const bodies = await Promise.all(
        probes.map(async (probe) => {
          const response = await post(gatedProject, {
            sql: probe.sql,
            ...(probe.parameters ? { parameters: probe.parameters } : {}),
          });
          expect(
            response.status === 200,
            `${probe.sql} — expected ${probe.answered ? "an answer" : "a refusal"}, got ${response.status}`,
          ).toBe(probe.answered);
          return { sql: probe.sql, text: await response.text() };
        }),
      );

      for (const { sql, text } of bodies) {
        for (const secret of secrets) {
          expect(
            text.includes(secret),
            `"${secret}" reached the caller through: ${sql}\n${text}`,
          ).toBe(false);
        }
      }
    });

    it("answers nothing about the other tenant, so the probe above is not empty for the wrong reason", async () => {
      expect(
        await adminRowCount("trace_summaries", openProject.id),
        "the other tenant has no rows — its absence from the answer proves nothing",
      ).toBeGreaterThan(0);
      const body = await run(
        gatedProject,
        `SELECT count() AS value FROM ${database}.traces WHERE TenantId = {tenant:String}`,
        { tenant: openProject.id },
      );
      expect(Number(body.rows[0].value)).toBe(0);
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
        const response = await post(openProject, { sql: "SELECT 1" }, { path });
        expect(response.status, path).toBe(404);
      }
    });
  });
});

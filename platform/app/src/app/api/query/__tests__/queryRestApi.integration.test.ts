/**
 * `POST /api/v1/query` and `GET /api/v1/query/schema`, the new REST door onto
 * LangWatchQL.
 *
 * The service, the executor and the tenant-isolation row policy are already
 * exhaustively proved — at the executor level by the proof suite, and through
 * this same HTTP door by `./queryRestServiceProofs.integration.test.ts`, which
 * drives the surface end to end: auth, RBAC, validator, gated columns,
 * diagnostics, truncation, credential leakage, all of it. Repeating that
 * coverage here would test the same service twice and miss the point of a
 * second suite.
 *
 * What is actually new is the door, and it changes two things that matter:
 *
 *  1. **`:projectId` is gone from the URL.** The old routes carried it
 *     decoratively — the tenant already came from the credential, and a path
 *     naming any other project answered not found — but the segment was still
 *     there to be misread as a selector. This family has no project id
 *     anywhere in its paths at all, so there is nothing to misread: the
 *     credential is the only place a tenant can come from.
 *  2. **The body IS the query, and a 200 IS the result.** Nothing is wrapped.
 *     A refusal is this API's canonical error envelope at the top level, the
 *     same shape every other REST family answers with — so a client that
 *     already parses this platform's errors needs no second parser here.
 *
 * Those two properties are this suite's reason to exist. The isolation case
 * proves the first rather than assuming it; the request/refusal cases prove
 * the second at the level the pure-unit suite cannot — through real auth, with
 * a real service behind it.
 *
 * Three habits carried over from both suites above, for the same reasons:
 *
 *  - Every "no foreign rows" claim is paired with an administrator-side
 *    control proving the foreign rows exist. An absence check passes against
 *    an empty database.
 *  - Every refusal is asserted by `code`/`status`, never by message prose.
 *  - Two tenants throughout, both seeded, so an isolation assertion has
 *    something to fail on.
 *
 * @see specs/analytics/lwql-api.feature
 * @see ./queryRest.unit.test.ts — the surface proved without a database
 * @see ./queryRestServiceProofs.integration.test.ts — the service/isolation proof this suite does not repeat
 * @see ~/server/analytics/lwql — the service under test
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
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
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "~/server/analytics/lwql/__tests__/lwqlClickHouseHarness";
import { LWQL_VIEW_CATALOG } from "~/server/analytics/lwql/catalog/lwqlViews";
import {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "~/server/analytics/lwql/views";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

/** Rows seeded per tenant. Small: this suite proves the door, not the data shape. */
const SEEDED_TRACES = 3;

/** Everything is seeded at one instant. No time-window case reads this file. */
const SEED_AT = "2026-02-20 12:00:00.000";

/** Captured content, per tenant, so a leak would name the exact string that escaped. */
function traceInput(tenantId: string) {
  return `CAPTURED-TRACE-INPUT-${tenantId}`;
}

function traceRow({
  tenantId,
  traceId,
  durationMs,
}: {
  tenantId: string;
  traceId: string;
  durationMs: number;
}) {
  return {
    ProjectionId: `${tenantId}/${traceId}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "1",
    Attributes: { "gen_ai.request.model": "gpt-5-mini" },
    OccurredAt: SEED_AT,
    UpdatedAt: SEED_AT,
    ComputedIOSchemaVersion: "1",
    ComputedInput: `${traceInput(tenantId)}/${traceId}`,
    ComputedOutput: `CAPTURED-TRACE-OUTPUT-${tenantId}/${traceId}`,
    TotalDurationMs: durationMs,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: ["gpt-5-mini"],
    TotalCost: 0.0042,
    TokensEstimated: false,
    TraceName: "checkout",
  };
}

/**
 * Seeds one tenant's trace_summaries fact table.
 *
 * Only the one dataset the tests below actually read. The full-catalog seed
 * (every fact table, dedup fixtures, PostgreSQL-resident views) is what the
 * analytics-sql suite already carries, and duplicating it here would seed
 * seven datasets to read one.
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
}

describe("given the /api/v1/query REST family", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let organization: Organization;
  let team: Team;
  let projectA: Project;
  let projectB: Project;
  let database: string;
  let facts: string;

  /** The two paths this family serves. */
  const runPath = "/api/v1/query";
  const schemaPath = "/api/v1/query/schema";

  const authHeaders = (token?: string | null) => ({
    "Content-Type": "application/json",
    ...(token === null ? {} : { "X-Auth-Token": token ?? "" }),
  });

  /** POSTs a raw body, so a malformed-body case can send whatever it likes. */
  const post = (body: unknown, options: { token?: string | null } = {}) =>
    app.request(runPath, {
      method: "POST",
      headers: authHeaders(options.token),
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /** GETs the schema door. */
  const getSchema = (options: { token?: string | null } = {}) =>
    app.request(schemaPath, {
      method: "GET",
      headers: authHeaders(options.token),
    });

  /**
   * Calls a door as one project and asserts it answered before returning the
   * body.
   *
   * The body is returned as-is: on this transport a `200` IS the payload, so
   * there is no envelope member to descend through and nothing to unwrap.
   */
  const succeed = async (response: Response, what: string) => {
    const body = (await response.json()) as Record<string, any>;
    if (response.status !== 200) {
      throw new Error(`${what} failed: ${JSON.stringify(body)}`);
    }
    if (body.error !== undefined) {
      throw new Error(`${what} answered an error`);
    }
    return body;
  };

  /** Reads the queryable schema as one project, asserting it answered. */
  const readSchema = async (project: Project) =>
    succeed(
      await getSchema({ token: project.apiKey }),
      "GET /api/v1/query/schema",
    );

  /** Runs SQL as one project and asserts it succeeded before returning it. */
  const run = async ({
    project,
    sql,
    parameters,
  }: {
    project: Project;
    sql: string;
    parameters?: Record<string, string | number | boolean>;
  }) =>
    succeed(
      await post(
        { sql, ...(parameters ? { parameters } : {}) },
        { token: project.apiKey },
      ),
      "POST /api/v1/query",
    );

  /** Rows one tenant holds in a named fact table, read as the administrator. */
  const adminRowCount = async ({
    table,
    tenantId,
  }: {
    table: string;
    tenantId: string;
  }) => {
    const [row] = await harness.admin
      .query({
        query: `SELECT count() AS value FROM ${facts}.${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
        format: "JSONEachRow",
      })
      .then((result) => result.json<{ value: string }>());
    return Number(row!.value);
  };

  beforeAll(async () => {
    // The REST routes that used to gate on this switch were removed by issue
    // #7565 along with the door they guarded; this family's routes call no
    // flag gate of their own. `RELEASE_LWQL_WORKBENCH` now controls only the
    // internal workbench UI, not any API path — set here purely for parity
    // with the sibling suite, so a future route-level gate added to this
    // family would find the suite already running with it on.
    process.env.RELEASE_LWQL_WORKBENCH = "1";

    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "queryapi",
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
      data: { name: "Query API Org", slug: `queryapi-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Query API Team",
        slug: `queryapi-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    projectA = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `queryapi-a-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    projectB = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `queryapi-b-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    // The key map turns a capability into a tenant, the same derivation the
    // gateway sends. Populating it is a deployment concern; here it is two
    // rows.
    await harness.admin.insert({
      table: `${database}.${harness.names.keyMapTable}`,
      format: "JSONEachRow",
      values: [projectA, projectB].map((project) => ({
        KeyHash: lwqlTenantCapability({ secret: project.lwqlKey }),
        TenantId: project.id,
      })),
    });

    for (const project of [projectA, projectB]) {
      await seedTenant({
        admin: harness.admin,
        database: facts,
        tenantId: project.id,
      });
      for (const statement of postgresTenantSeedStatements({
        tenantId: project.id,
      })) {
        const result = await postgres.asAdmin(statement);
        if (result.exitCode !== 0) {
          throw new Error(result.stderr);
        }
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
    // Guarded on the identifier each statement actually uses, so a
    // team-creation failure never leaves the organization behind and never
    // turns an undefined teamId into a deleteMany matching every project.
    if (team) {
      await prisma.project.deleteMany({ where: { teamId: team.id } });
      await prisma.team.delete({ where: { id: team.id } });
    }
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when an authenticated project runs a query", () => {
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it("returns 200 with typed columns and rows", async () => {
      const body = await run({
        project: projectA,
        sql: `SELECT TraceId, TotalDurationMs FROM ${database}.traces ORDER BY TraceId`,
      });

      expect(body.columns).toEqual([
        { name: "TraceId", type: "String" },
        { name: "TotalDurationMs", type: "Int64" },
      ]);
      expect(body.rows).toHaveLength(SEEDED_TRACES);
    });

    it("resolves an unqualified dataset name, the same as the credential-scoped door", async () => {
      const body = await run({
        project: projectA,
        sql: "SELECT count() AS value FROM traces",
      });
      expect(Number(body.rows[0].value)).toBe(SEEDED_TRACES);
    });
  });

  describe("when the schema door is called", () => {
    /** @scenario "Authenticated client discovers its LangWatchQL schema scoped to its own permissions" */
    it("returns the queryable views", async () => {
      const result = await readSchema(projectA);

      expect(result.database).toBe(database);
      expect(result.datasets.map((dataset: any) => dataset.name)).toEqual(
        LWQL_VIEW_CATALOG.map((view) => `${database}.${view.name}`),
      );
    });

    /**
     * A GET, and therefore genuinely argument-free: the credential is the
     * whole of its input. A query string it does not read must not change the
     * answer.
     */
    it("ignores a query string it does not read", async () => {
      const response = await app.request(`${schemaPath}?nonsense=1`, {
        method: "GET",
        headers: authHeaders(projectA.apiKey),
      });
      const result = await succeed(response, "GET /api/v1/query/schema");
      expect(result.database).toBe(database);
    });
  });

  describe("when two projects hit the identical URL with their own credentials", () => {
    /**
     * The property that justified dropping `:projectId`: nothing in the path
     * can name a tenant, so the only way two callers at the same URL could
     * ever see different rows is that the credential itself selects the
     * tenant. That is what this proves, not merely that isolation holds — the
     * old suite already proved isolation holds; this proves it still holds
     * with no project id in the URL to (mis)read as the selector.
     */
    /** @scenario "A LangWatchQL view returns only the calling tenant's rows" */
    it("each gets only its own tenant's rows from the exact same path", async () => {
      // The point of the shared path: neither tenant is named in the URL, so
      // the credential is the only selector. Asserted against the real ids
      // rather than a shape heuristic — a heuristic here would pass against a
      // path that happened to look right while naming a tenant.
      for (const path of [runPath, schemaPath]) {
        expect(path).not.toContain(projectA.id);
        expect(path).not.toContain(projectB.id);
      }

      for (const [caller, other] of [
        [projectA, projectB],
        [projectB, projectA],
      ] as const) {
        expect(
          await adminRowCount({ table: "trace_summaries", tenantId: other.id }),
          "the other tenant has no rows — 'no foreign rows returned' would be vacuous",
        ).toBeGreaterThan(0);

        const body = await run({
          project: caller,
          sql: `SELECT DISTINCT TenantId FROM ${database}.traces`,
        });
        expect(body.rows.map((row: any) => row.TenantId)).toEqual([caller.id]);
      }
    });

    it("keeps the schema endpoint's dataset rows off the response for a query naming the other tenant", async () => {
      const foreignRows = await adminRowCount({
        table: "trace_summaries",
        tenantId: projectB.id,
      });
      expect(foreignRows).toBeGreaterThan(0);

      // The foreign tenant id is *bound*, not interpolated: the claim under
      // test is that the view refuses to reach another tenant's rows even when
      // the caller names it, and a hand-built string literal would test the
      // quoting as much as the isolation.
      const body = await run({
        project: projectA,
        sql: `SELECT count() AS value FROM ${database}.traces WHERE TenantId = {foreignTenantId:String}`,
        parameters: { foreignTenantId: projectB.id },
      });
      expect(
        Number(body.rows[0].value),
        `the endpoint reached ${foreignRows} foreign rows`,
      ).toBe(0);
    });
  });

  describe("when the credential is missing or invalid", () => {
    /**
     * Both doors, both credential failures. Each is checked rather than
     * assumed to follow from the other: the two routes carry their own access
     * chain, and a gate dropped from one of them would show up here and
     * nowhere else.
     */
    it.each([
      ["no credential", null],
      ["a credential that names no project", "sk-not-a-real-api-key"],
    ])("refuses POST /api/v1/query with %s", async (_label, token) => {
      const response = await post({ sql: "SELECT 1" }, { token });
      expect(response.status).toBe(401);
    });

    it.each([
      ["no credential", null],
      ["a credential that names no project", "sk-not-a-real-api-key"],
    ])("refuses GET /api/v1/query/schema with %s", async (_label, token) => {
      const response = await getSchema({ token });
      expect(response.status).toBe(401);
    });

    /**
     * One envelope for the whole platform.
     *
     * This family briefly wrapped its refusals in a JSON-RPC `error`, which
     * meant an auth denial (raised beneath the family's own handler) and a
     * query refusal answered in two different shapes — and an integrator had
     * to branch on the HTTP status before it could read a `code` at all. Plain
     * REST removes that seam; this pins it removed.
     */
    it("answers a credential refusal in the canonical envelope, at the top level", async () => {
      const response = await post({ sql: "SELECT 1" }, { token: null });
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(401);
      expect(
        body.jsonrpc,
        "a JSON-RPC envelope came back from a REST door",
      ).toBeUndefined();
      // The canonical shape, so one parser reads it. Asserted against the
      // string taxonomy at the TOP level — there is no `error.data` to descend
      // into, and a numeric code here would mean the body had been wrapped.
      expect(body.error?.code).toBe("missing_credentials");
      expect(typeof body.error?.code).toBe("string");
    });
  });

  describe("when the request body is wrong", () => {
    /**
     * Authenticated throughout: these prove how the *body* is judged, and an
     * unauthenticated request would be refused before the body is ever read.
     *
     * A function, not a captured object: `projectA` is seeded in `beforeAll`,
     * which runs after this block's body is collected.
     */
    const asProjectA = () => ({ token: projectA.apiKey });

    /**
     * 400, not 422. The shared validator raises `validation_error` at 422 for
     * the families that predate the canonical envelope, and `canonical-error`
     * deliberately remaps it to 400 so one code does not carry two statuses
     * across the API. This family publishes the canonical envelope, so it gets
     * the remapped status — asserted here so a change to that mapping surfaces
     * as a failing contract rather than a silent shift under a client.
     */
    const BODY_REFUSAL_STATUS = 400;

    it("refuses a body with no statement", async () => {
      const response = await post({}, asProjectA());
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(BODY_REFUSAL_STATUS);
      expect(
        body.error,
        "a refusal arrived with no error member",
      ).toBeDefined();
    });

    it("refuses a top-level array rather than reading one element of it", async () => {
      const response = await post([{ sql: "SELECT 1" }], asProjectA());
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(BODY_REFUSAL_STATUS);
      expect(
        body.columns,
        "an array body was partially answered",
      ).toBeUndefined();
    });

    it("refuses a body that is not JSON at all", async () => {
      const response = await post("this is not json", asProjectA());
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });

    /**
     * The contract that lets one client parse the whole platform: a refusal
     * here carries this API's canonical error body, with its machine-readable
     * `code`, at the top level — the same place every other REST family puts
     * it.
     */
    it("carries the canonical error envelope at the top level", async () => {
      const response = await post({ sql: 42 }, asProjectA());
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(BODY_REFUSAL_STATUS);
      expect(body.error?.code).toBeTruthy();
      expect(typeof body.error?.code).toBe("string");
    });

    /**
     * The per-field chain, which is what turns a refusal into something a
     * caller can act on rather than merely observe.
     */
    it("names the offending field in the refusal", async () => {
      const response = await post({ sql: 42 }, asProjectA());
      const body = (await response.json()) as Record<string, any>;

      expect(JSON.stringify(body)).toContain("sql");
    });
  });
});

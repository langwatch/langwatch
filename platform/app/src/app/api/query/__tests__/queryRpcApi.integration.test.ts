/**
 * `POST /api/v1/query`, the new JSON-RPC door onto LangWatchQL.
 *
 * The service, the executor and the tenant-isolation row policy are already
 * exhaustively proved — at the executor level by the proof suite, and through
 * this same HTTP door by `./queryRpcServiceProofs.integration.test.ts`, which
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
 *  2. **The method is in the body, not the path.** Which means a single URL
 *     now serves both calls, and the *envelope* is what routes them. The
 *     failure mode that creates is new: a reply that reaches the wrong caller,
 *     or a refusal a client cannot classify.
 *
 * Those two properties are this suite's reason to exist. The isolation case
 * proves the first rather than assuming it; the envelope cases prove the
 * second at the level the pure-unit suite cannot — through real auth, with a
 * real service behind it.
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
 * @see ./queryRpc.unit.test.ts — the envelope proved without a database
 * @see ./queryRpcServiceProofs.integration.test.ts — the service/isolation proof this suite does not repeat
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

describe("given the /api/v1/query JSON-RPC family", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let organization: Organization;
  let team: Team;
  let projectA: Project;
  let projectB: Project;
  let database: string;
  let facts: string;

  /** One path for every method — that is the transport's whole shape. */
  const rpcPath = "/api/v1/query";

  /** POSTs a raw body, so a malformed-envelope case can send whatever it likes. */
  const post = (body: unknown, options: { token?: string | null } = {}) =>
    app.request(rpcPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.token === null
          ? {}
          : { "X-Auth-Token": options.token ?? "" }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /** A well-formed JSON-RPC call, with an id the assertions can match on. */
  const call = (
    method: string,
    params?: unknown,
    options: { token?: string | null; id?: unknown } = {},
  ) =>
    post(
      {
        jsonrpc: "2.0",
        id: options.id ?? 1,
        method,
        ...(params === undefined ? {} : { params }),
      },
      options,
    );

  /**
   * Calls a method as one project and asserts it succeeded before returning
   * `result`.
   *
   * The id check is not decoration: on a transport where one URL serves every
   * call, the id is the only thing tying a reply to its request, so every
   * success in this suite proves it survived the round trip.
   */
  const succeed = async (
    project: Project,
    method: string,
    params?: unknown,
  ) => {
    const response = await call(method, params, {
      token: project.apiKey,
      id: 42,
    });
    const body = (await response.json()) as Record<string, any>;
    if (response.status !== 200) {
      throw new Error(`${method} failed: ${JSON.stringify(body)}`);
    }
    if (body.jsonrpc !== "2.0") {
      throw new Error(`${method} answered with jsonrpc ${body.jsonrpc}`);
    }
    if (body.id !== 42) {
      throw new Error("the reply dropped the id it was called with");
    }
    if (body.error !== undefined) {
      throw new Error(`${method} answered an error`);
    }
    return body.result as Record<string, any>;
  };

  /** Runs SQL as one project and asserts it succeeded before returning it. */
  const run = (project: Project, sql: string) =>
    succeed(project, "query.run", { sql });

  /** Rows one tenant holds in a named fact table, read as the administrator. */
  const adminRowCount = async (table: string, tenantId: string) => {
    const [row] = await harness.admin
      .query({
        query: `SELECT count() AS value FROM ${facts}.${table} WHERE TenantId = '${tenantId}'`,
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
      const body = await run(
        projectA,
        `SELECT TraceId, TotalDurationMs FROM ${database}.traces ORDER BY TraceId`,
      );

      expect(body.columns).toEqual([
        { name: "TraceId", type: "String" },
        { name: "TotalDurationMs", type: "Int64" },
      ]);
      expect(body.rows).toHaveLength(SEEDED_TRACES);
    });

    it("resolves an unqualified dataset name, the same as the credential-scoped door", async () => {
      const body = await run(projectA, "SELECT count() AS value FROM traces");
      expect(Number(body.rows[0].value)).toBe(SEEDED_TRACES);
    });
  });

  describe("when query.schema is called", () => {
    /** @scenario "Authenticated client discovers its LangWatchQL schema scoped to its own permissions" */
    it("returns the queryable views", async () => {
      const result = await succeed(projectA, "query.schema");

      expect(result.database).toBe(database);
      expect(result.datasets.map((dataset: any) => dataset.name)).toEqual(
        LWQL_VIEW_CATALOG.map((view) => `${database}.${view.name}`),
      );
    });

    /**
     * The method takes no arguments, and a client sending `params: {}` for
     * uniformity across its call sites must not be punished for it.
     */
    it("accepts an empty params object as readily as none at all", async () => {
      const result = await succeed(projectA, "query.schema", {});
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
      expect(rpcPath).not.toContain(projectA.id);
      expect(rpcPath).not.toContain(projectB.id);

      for (const [caller, other] of [
        [projectA, projectB],
        [projectB, projectA],
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

    it("keeps the schema endpoint's dataset rows off the response for a query naming the other tenant", async () => {
      const foreignRows = await adminRowCount("trace_summaries", projectB.id);
      expect(foreignRows).toBeGreaterThan(0);

      const body = await run(
        projectA,
        `SELECT count() AS value FROM ${database}.traces WHERE TenantId = '${projectB.id}'`,
      );
      expect(
        Number(body.rows[0].value),
        `the endpoint reached ${foreignRows} foreign rows`,
      ).toBe(0);
    });
  });

  describe("when the credential is missing or invalid", () => {
    /**
     * Every method, both credential failures. On this transport the method is
     * a *body* field, so it is reached by the same route and the same
     * middleware chain — which is exactly why each one is checked rather than
     * assumed to follow from the other. A dispatch that ran before the auth
     * gate would show up here and nowhere else.
     */
    it.each([
      ["no credential", null],
      ["a credential that names no project", "sk-not-a-real-api-key"],
    ])("refuses query.run with %s", async (_label, token) => {
      const response = await call("query.run", { sql: "SELECT 1" }, { token });
      expect(response.status).toBe(401);
    });

    it.each([
      ["no credential", null],
      ["a credential that names no project", "sk-not-a-real-api-key"],
    ])("refuses query.schema with %s", async (_label, token) => {
      const response = await call("query.schema", undefined, { token });
      expect(response.status).toBe(401);
    });

    /**
     * An unauthenticated caller must not be able to use the method name as an
     * oracle. If dispatch ran first, a bad method would answer 404 and a good
     * one 401 — turning this door into a free directory of what it serves.
     */
    /**
     * The documented exception, pinned.
     *
     * Authentication answers BENEATH the family's error handler, so a 401 is
     * the canonical envelope alone — not wrapped in a JSON-RPC `error`. That
     * is a real seam in the contract, and the endpoint description tells
     * integrators to branch on status before reading `error.code` precisely
     * because of it. Asserted here so the description stays true: if the
     * wrapping ever extends to cover auth, this fails and the docs get fixed
     * with it.
     */
    it("answers a credential refusal in the canonical envelope, unwrapped", async () => {
      const response = await call(
        "query.run",
        { sql: "SELECT 1" },
        { token: null },
      );
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(401);
      expect(
        body.jsonrpc,
        "auth refusals are documented as unwrapped — update the endpoint description if this changed",
      ).toBeUndefined();
      // Still the canonical shape, so one parser reads it. Asserted against
      // the string taxonomy at the TOP level — unwrapped, there is no
      // `error.data` to descend into, and a numeric code here would mean the
      // body had been wrapped after all.
      expect(body.error?.code).toBe("missing_credentials");
      expect(typeof body.error?.code).toBe("string");
    });

    it("does not let an unauthenticated caller probe which methods exist", async () => {
      const real = await call(
        "query.run",
        { sql: "SELECT 1" },
        { token: null },
      );
      const fake = await call("query.nope", {}, { token: null });

      expect(real.status).toBe(401);
      expect(
        fake.status,
        "an unknown method answered differently from a known one without auth",
      ).toBe(401);
    });
  });

  describe("when the envelope itself is wrong", () => {
    /**
     * Authenticated throughout: these prove how the *envelope* is judged, and
     * an unauthenticated request would be refused before the envelope is ever
     * read.
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
    const ENVELOPE_REFUSAL_STATUS = 400;

    it("refuses a method it does not serve, and says so in the envelope", async () => {
      const response = await call("query.nope", {}, { token: projectA.apiKey });
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(ENVELOPE_REFUSAL_STATUS);
      expect(
        body.error,
        "a refusal arrived with no error member",
      ).toBeDefined();
      // -32600: the envelope enumerates the methods, so an unknown one is
      // refused as an invalid request before dispatch is ever reached.
      expect(body.error.code).toBe(-32600);
    });

    it("refuses a batch rather than answering one element of it", async () => {
      const response = await post(
        [{ jsonrpc: "2.0", id: 1, method: "query.schema" }],
        asProjectA(),
      );
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(ENVELOPE_REFUSAL_STATUS);
      expect(body.result, "a batch was partially answered").toBeUndefined();
    });

    it("refuses a body that is not JSON at all", async () => {
      const response = await post("this is not json", asProjectA());
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });

    /**
     * The contract that lets one client parse both surfaces: an RPC failure
     * carries this API's canonical error body, with its machine-readable
     * `code`, inside `error.data`.
     */
    it("carries the canonical error envelope inside error.data", async () => {
      const response = await call(
        "query.run",
        { sql: 42 },
        { token: projectA.apiKey },
      );
      const body = (await response.json()) as Record<string, any>;

      expect(response.status).toBe(ENVELOPE_REFUSAL_STATUS);
      expect(body.error.data?.error?.code).toBeTruthy();
    });

    /**
     * A failure must still be routable. This is the case the unit suite proves
     * against a stubbed context; here it is proved through the real error
     * handler, which is the one that has to read the id back off a request
     * whose body was already consumed.
     */
    it("echoes the id on a failure, so the client can match the refusal", async () => {
      const response = await call(
        "query.run",
        { sql: 42 },
        { token: projectA.apiKey, id: "call-7" },
      );
      const body = (await response.json()) as Record<string, any>;

      expect(body.id, "the error reply dropped its id").toBe("call-7");
    });
  });
});

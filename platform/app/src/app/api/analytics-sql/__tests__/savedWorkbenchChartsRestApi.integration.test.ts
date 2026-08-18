/**
 * The saved workbench chart endpoints, driven through the real HTTP app.
 *
 * Every request here goes through the shipped Hono app — the unified auth
 * middleware, the API-key ceiling, the feature switch, the validator, the
 * service and both of its governors — against a real Postgres. Nothing between
 * the request and the row is stubbed.
 *
 * No ClickHouse: nothing in this slice executes a statement. The LangWatchQL
 * validator is consulted for a verdict, which it reaches from the catalog and
 * the caller's permissions alone, so a chart can be saved on a deployment that
 * could not run it — and the suite proves the gate rather than the database.
 *
 * Three habits carried over from the LangWatchQL REST suite, for the same
 * reasons:
 *
 *  - Every "nothing was written" claim is paired with the listing that would
 *    have shown it. A refusal on its own passes against a handler that wrote
 *    first and threw afterwards.
 *  - Every refusal is asserted by `code`, never by message prose.
 *  - Two projects in two organizations throughout, both holding charts, so an
 *    isolation assertion has something to fail on.
 *
 * The family publishes the canonical error envelope, so a refusal is read at
 * `body.error.code` and its structured detail at `body.error.meta` — the same
 * places the LangWatchQL REST suite reads them.
 *
 * @see ~/app/api/shared/canonical-error — the mapping every refusal here goes
 *   through, including the 5xx redaction one case below turns on
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see ~/server/analytics/saved-workbench-charts — the service under test
 */

import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { VEGA_LITE_SCHEMA_URL } from "~/features/analytics-query/visualization/vegaLiteSchema";
import {
  type Organization,
  type Project,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { WORKBENCH_SQL_CHART_KIND } from "~/server/analytics/chartKinds";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { getFeatureFlagStore } from "~/server/featureFlag";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

/** Names a LangWatchQL dataset every deployment publishes, and reads nothing gated. */
const SQL =
  "SELECT count() AS value FROM analytics.traces WHERE OccurredAt >= {since:DateTime}";

/** Names a column the gated project's data-privacy rule withholds. */
const GATED_SQL = "SELECT CapturedInput FROM analytics.traces";

const SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { y: { field: "value", type: "quantitative" } },
};

const DEFINITION = {
  version: 1,
  sql: SQL,
  parameters: { since: "2026-02-01 00:00:00" },
  vegaLiteSpec: SPEC,
};

/** Loads its data over the network — the visualization policy refuses it. */
const NETWORK_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { url: "https://example.invalid/rows.json" },
  mark: "bar",
};

type Body = Record<string, any>;

describe("given the saved workbench chart REST endpoints", () => {
  const ns = nanoid(8);

  let organization: Organization;
  let team: Team;
  let otherOrganization: Organization;
  let otherTeam: Team;
  /** Fully permitted: the platform default policy captures every category. */
  let openProject: Project;
  /** Content-gated by a `restrict` data-privacy rule on input and output. */
  let gatedProject: Project;
  /** Another organization entirely, so tenancy has a real boundary to cross. */
  let otherProject: Project;
  /** A scoped key holding `analytics:view` on this organization and nothing else. */
  let viewOnlyToken: string;

  const chartsPath = (project: Project) =>
    `/api/v1/projects/${project.id}/analytics/charts`;
  const chartPath = (project: Project, chartId: string) =>
    `${chartsPath(project)}/${chartId}`;

  /** The credential a request presents: a project's own key, unless told otherwise. */
  const asProject = (project: Project) => ({ "X-Auth-Token": project.apiKey });
  const asViewOnly = (project: Project) => ({
    Authorization: `Bearer ${viewOnlyToken}`,
    "X-Project-Id": project.id,
  });

  const call = (options: {
    path: string;
    method?: string;
    body?: unknown;
    auth: Record<string, string>;
  }) =>
    app.request(options.path, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", ...options.auth },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });

  /** Runs a request expected to succeed, and returns its parsed body. */
  const succeeds = async (
    options: Parameters<typeof call>[0] & { status?: number },
  ): Promise<Body> => {
    const response = await call(options);
    const body = (await response.json()) as Body;
    expect(
      response.status,
      `${options.method ?? "GET"} ${options.path} failed: ${JSON.stringify(body)}`,
    ).toBe(options.status ?? 200);
    return body;
  };

  /** Runs a request expected to be refused, and returns its parsed body. */
  const refused = async (
    options: Parameters<typeof call>[0],
  ): Promise<Body> => {
    const response = await call(options);
    const body = (await response.json()) as Body;
    expect(
      response.status,
      `${options.method ?? "GET"} ${options.path} was not refused: ${JSON.stringify(body)}`,
    ).toBeGreaterThanOrEqual(400);
    return body;
  };

  /** Creates a chart with the project's own key, asserting it was created. */
  const createChart = async (
    project: Project,
    overrides: { name?: string; definition?: unknown } = {},
  ): Promise<Body> =>
    await succeeds({
      path: chartsPath(project),
      method: "POST",
      auth: asProject(project),
      status: 201,
      body: {
        name: overrides.name ?? "Traces per day",
        definition:
          overrides.definition === undefined
            ? DEFINITION
            : overrides.definition,
      },
    });

  /** The ids the project's own key can see, in listing order. */
  const listedIds = async (project: Project): Promise<string[]> => {
    const body = await succeeds({
      path: chartsPath(project),
      auth: asProject(project),
    });
    return (body.data as Body[]).map((chart) => chart.id);
  };

  beforeAll(async () => {
    // The surface ships behind the experimental feature switch, off by
    // default. The suite runs with it on via the flag's own env override —
    // the same lever a deployment uses — and the flag-off cases below unset
    // it for exactly one request.
    process.env.RELEASE_LWQL_WORKBENCH = "1";

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
      data: { name: "Saved charts org", slug: `saved-charts-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Saved charts team",
        slug: `saved-charts-${ns}`,
        organizationId: organization.id,
      },
    });
    otherOrganization = await prisma.organization.create({
      data: { name: "Other org", slug: `saved-charts-other-${ns}` },
    });
    otherTeam = await prisma.team.create({
      data: {
        name: "Other team",
        slug: `saved-charts-other-${ns}`,
        organizationId: otherOrganization.id,
      },
    });

    const projectIn = async (teamId: string, slug: string) =>
      await prisma.project.create({
        data: {
          ...projectFactory.build({ slug: `${slug}-${ns}` }),
          teamId,
          personalFeatures: {},
        },
      });
    openProject = await projectIn(team.id, "open");
    gatedProject = await projectIn(team.id, "gated");
    otherProject = await projectIn(otherTeam.id, "other");

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

    // A real scoped key rather than a stubbed permission check: the claim is
    // "a key that may read cannot write", and a mocked check can only ever
    // agree with whatever it was told to return.
    const created = await ApiKeyService.create(prisma).create({
      name: `saved-charts-view-only-${ns}`,
      organizationId: organization.id,
      permissionMode: "restricted",
      permissions: ["analytics:view"],
      bindings: [
        {
          role: TeamUserRole.CUSTOM,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    });
    viewOnlyToken = created.token;
  }, 120_000);

  afterEach(async () => {
    // `.filter(Boolean)` for the same reason as `afterAll` below: a setup
    // failure must not be buried under teardown TypeErrors.
    for (const project of [openProject, gatedProject, otherProject].filter(
      Boolean,
    )) {
      await prisma.customGraph.deleteMany({ where: { projectId: project.id } });
    }
  });

  afterAll(async () => {
    delete process.env.RELEASE_LWQL_WORKBENCH;
    // Every statement is guarded on the identifier it actually uses, so a
    // failure half way through setup never turns an undefined id into a
    // `deleteMany` that matches every row in the database. The chart deletes
    // name their project ids outright — the multitenancy middleware refuses a
    // `CustomGraph` delete reached through a relation, which is the point of it.
    const projectIds = [openProject, gatedProject, otherProject]
      .filter(Boolean)
      .map((project) => project.id);
    if (projectIds.length > 0) {
      await prisma.customGraph.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    if (team) {
      await prisma.dataPrivacyPolicy.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.roleBinding.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.apiKey.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.customRole.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.project.deleteMany({ where: { teamId: team.id } });
      await prisma.team.delete({ where: { id: team.id } });
    }
    if (otherTeam) {
      await prisma.project.deleteMany({ where: { teamId: otherTeam.id } });
      await prisma.team.delete({ where: { id: otherTeam.id } });
    }
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    if (otherOrganization) {
      await prisma.organization.delete({ where: { id: otherOrganization.id } });
    }
  });

  describe("when an integration creates a chart and reads it back", () => {
    /** @scenario "A chart created over the API reads back exactly as it was submitted" */
    it("round-trips the statement, the parameter values and the specification", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const read = await succeeds({
        path: chartPath(openProject, created.id),
        auth: asProject(openProject),
      });

      expect(read.id).toBe(created.id);
      expect(read.name).toBe("Volume");
      // Byte for byte: a handler that normalised the statement would still
      // round-trip something, just not what the caller submitted.
      expect(read.definition.sql).toBe(SQL);
      expect(read.definition.parameters).toEqual(DEFINITION.parameters);
      expect(read.definition.vegaLiteSpec).toEqual(SPEC);
      expect(read.definition.version).toBe(DEFINITION.version);
      expect(typeof read.platformUrl).toBe("string");

      expect(await listedIds(openProject)).toEqual([created.id]);
    });

    /** @scenario "A chart created over the API reads back exactly as it was submitted" */
    it("lists a project's own charts and nothing of the other project's", async () => {
      const mine = await createChart(openProject, { name: "Mine" });
      const theirs = await createChart(otherProject, { name: "Theirs" });

      expect(await listedIds(openProject)).toEqual([mine.id]);
      expect(await listedIds(otherProject)).toEqual([theirs.id]);
    });
  });

  describe("when the specification breaks the visualization policy", () => {
    /** @scenario "A specification the chart policy refuses is refused over the API, and nothing is written" */
    it("refuses with the policy's own code and writes nothing", async () => {
      const body = await refused({
        path: chartsPath(openProject),
        method: "POST",
        auth: asProject(openProject),
        body: {
          name: "Loads over the network",
          definition: { ...DEFINITION, vegaLiteSpec: NETWORK_SPEC },
        },
      });

      expect(body.error.code).toBe(
        "saved_workbench_chart_specification_refused",
      );
      // The refusal's `meta` reaches the wire under the envelope's own `meta`;
      // what matters is that the rule and the JSON path survive, so an author
      // can repair the offending part rather than re-reading it all.
      const errors = body.error.meta.errors;
      expect(Array.isArray(errors)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].rule).toBeTruthy();
      expect(errors[0].path).toBeTruthy();

      // The half that matters: a handler that wrote first and threw afterwards
      // passes every assertion above.
      expect(await listedIds(openProject)).toEqual([]);
    });

    /** @scenario "A specification the chart policy refuses is refused over the API, and nothing is written" */
    it("refuses an edit into the same specification and leaves the chart as it was", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const body = await refused({
        path: chartPath(openProject, created.id),
        method: "PATCH",
        auth: asProject(openProject),
        body: { definition: { ...DEFINITION, vegaLiteSpec: NETWORK_SPEC } },
      });
      expect(body.error.code).toBe(
        "saved_workbench_chart_specification_refused",
      );

      const after = await succeeds({
        path: chartPath(openProject, created.id),
        auth: asProject(openProject),
      });
      expect(after.definition.vegaLiteSpec).toEqual(SPEC);
    });
  });

  describe("when the LangWatchQL validator refuses the statement", () => {
    /** @scenario "SQL the LangWatchQL validator refuses earns the same code over the API as the query endpoint" */
    it("gives the same code the query endpoint gives that key for that statement", async () => {
      const saving = await refused({
        path: chartsPath(gatedProject),
        method: "POST",
        auth: asProject(gatedProject),
        body: {
          name: "Withheld column",
          definition: { ...DEFINITION, sql: GATED_SQL },
        },
      });

      const running = await refused({
        path: `/api/v1/projects/${gatedProject.id}/analytics/query/clickhouse`,
        method: "POST",
        auth: asProject(gatedProject),
        body: { sql: GATED_SQL },
      });

      expect(saving.error.code).toBe("lwql_not_permitted");
      expect(saving.error.code).toBe(running.error.code);
      expect(await listedIds(gatedProject)).toEqual([]);

      // The control: the same statement, a key whose protections do not
      // withhold the column. Without it the refusal above could be about the
      // SQL rather than about the gate.
      const permitted = await createChart(openProject, {
        name: "Same statement, permitted key",
        definition: { ...DEFINITION, sql: GATED_SQL },
      });
      expect(permitted.definition.sql).toBe(GATED_SQL);
    });

    /** @scenario "SQL the LangWatchQL validator refuses earns the same code over the API as the query endpoint" */
    it("refuses a write dressed as a chart, and a definition of the wrong shape", async () => {
      const write = await refused({
        path: chartsPath(openProject),
        method: "POST",
        auth: asProject(openProject),
        body: {
          name: "A write dressed as a chart",
          definition: { ...DEFINITION, sql: "DROP TABLE analytics.traces" },
        },
      });
      expect(write.error.code).toBe("lwql_not_permitted");

      const shapeless = await refused({
        path: chartsPath(openProject),
        method: "POST",
        auth: asProject(openProject),
        body: { name: "Shapeless", definition: { sql: SQL } },
      });
      expect(shapeless.error.code).toBe("validation_error");

      expect(await listedIds(openProject)).toEqual([]);
    });
  });

  describe("when a definition is larger than the endpoint accepts", () => {
    /**
     * The same statement, made long by a trailing comment, so size is the only
     * thing that varies between the control and the refusal. The statement is
     * the part nothing below the route bounds — the versioned definition schema
     * puts no ceiling on it — so this is the shape that would actually be
     * stored if the request-shape ceiling were removed.
     */
    const paddedSql = (padding: number) => `${SQL} -- ${"x".repeat(padding)}`;

    /** @scenario "A definition larger than the endpoint's ceiling is refused before anything is stored" */
    it("refuses the create and the same edit, and stores neither", async () => {
      // The control: identical padding, small. Without it the refusals below
      // could be about the comment rather than about the size.
      const permitted = await createChart(openProject, {
        name: "Padded, and within the ceiling",
        definition: { ...DEFINITION, sql: paddedSql(1_000) },
      });
      expect(permitted.definition.sql).toBe(paddedSql(1_000));

      const creating = await refused({
        path: chartsPath(openProject),
        method: "POST",
        auth: asProject(openProject),
        body: {
          name: "Past the ceiling",
          definition: { ...DEFINITION, sql: paddedSql(400_000) },
        },
      });
      expect(creating.error.code).toBe("validation_error");

      const editing = await refused({
        path: chartPath(openProject, permitted.id),
        method: "PATCH",
        auth: asProject(openProject),
        body: { definition: { ...DEFINITION, sql: paddedSql(400_000) } },
      });
      expect(editing.error.code).toBe("validation_error");

      // The half that matters: the control chart is the only thing here, and it
      // still holds the statement it was saved with.
      expect(await listedIds(openProject)).toEqual([permitted.id]);
      const after = await succeeds({
        path: chartPath(openProject, permitted.id),
        auth: asProject(openProject),
      });
      expect(after.definition.sql).toBe(paddedSql(1_000));
    });
  });

  describe("when the LangWatchQL feature switch is off for the project", () => {
    /** Runs one request with the switch off, whatever else the suite set. */
    const withFlagOff = async <T>(request: () => Promise<T>): Promise<T> => {
      // The env override is consulted before the force-enable list, so `0`
      // really does switch it off on a deployment (and in this repository's
      // own `.env`) that force-enables the flag.
      process.env.RELEASE_LWQL_WORKBENCH = "0";
      try {
        return await request();
      } finally {
        process.env.RELEASE_LWQL_WORKBENCH = "1";
      }
    };

    /** @scenario "Every chart endpoint stays dark while the workbench switch is off" */
    it("refuses all five verbs with the named refusal", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const refusals = await withFlagOff(async () => [
        await refused({
          path: chartsPath(openProject),
          auth: asProject(openProject),
        }),
        await refused({
          path: chartPath(openProject, created.id),
          auth: asProject(openProject),
        }),
        await refused({
          path: chartsPath(openProject),
          method: "POST",
          auth: asProject(openProject),
          body: { name: "Another", definition: DEFINITION },
        }),
        await refused({
          path: chartPath(openProject, created.id),
          method: "PATCH",
          auth: asProject(openProject),
          body: { name: "Renamed" },
        }),
        await refused({
          path: chartPath(openProject, created.id),
          method: "DELETE",
          auth: asProject(openProject),
        }),
      ]);

      expect(refusals.map((body) => body.error.code)).toEqual(
        Array(5).fill("lwql_not_enabled"),
      );
      // Neither the write nor the delete happened while the surface was off.
      expect(await listedIds(openProject)).toEqual([created.id]);
    });
  });

  describe("when a stored organization rule is the only thing enabling the switch", () => {
    /**
     * No environment override, a row whose default is off, and one rule keyed
     * to an organization: the surface is on exactly for that organization's
     * projects. Runs against the real store, so this is the whole chain — the
     * guard resolves the project's organization, the rule matches it.
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
      // Both env doors must be shut or the rule is never consulted: the dev
      // `.env` force-enables this flag, and force-enable wins before the
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

    /** @scenario "The API's switch is decided for the project's organization" */
    it("answers for a project in the granted organization", async () => {
      const response = await withOrganizationRule(organization.id, async () =>
        call({ path: chartsPath(openProject), auth: asProject(openProject) }),
      );
      expect(response.status).toBe(200);
    });

    /** @scenario "The API's switch is decided for the project's organization" */
    it("still refuses a project whose organization holds no grant", async () => {
      const response = await withOrganizationRule(
        otherOrganization.id,
        async () =>
          call({ path: chartsPath(openProject), auth: asProject(openProject) }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as Body).error.code).toBe(
        "lwql_not_enabled",
      );
    });
  });

  describe("when another project's key names a chart by its id", () => {
    /** @scenario "A chart is invisible to another project's key" */
    it("answers not found on every verb, and leaves the chart untouched", async () => {
      const mine = await createChart(openProject, { name: "Mine" });

      for (const [method, body] of [
        ["GET", undefined],
        ["PATCH", { name: "Mine now" }],
        ["DELETE", undefined],
      ] as const) {
        const refusal = await refused({
          path: chartPath(otherProject, mine.id),
          method,
          auth: asProject(otherProject),
          ...(body === undefined ? {} : { body }),
        });
        expect(refusal.error.code, method).toBe(
          "saved_workbench_chart_not_found",
        );
      }

      // An id that never existed answers identically, so the refusal above
      // discloses nothing about whether the chart is real.
      const never = await refused({
        path: chartPath(otherProject, `never-${nanoid()}`),
        auth: asProject(otherProject),
      });
      expect(never.error.code).toBe("saved_workbench_chart_not_found");

      expect(await listedIds(otherProject)).toEqual([]);

      const after = await succeeds({
        path: chartPath(openProject, mine.id),
        auth: asProject(openProject),
      });
      expect(after.name).toBe("Mine");
      expect(after.definition.sql).toBe(SQL);
    });
  });

  describe("when the path names a project the credential does not belong to", () => {
    /** @scenario "A path naming another project reaches nothing" */
    it("answers project not found, for a project that demonstrably exists", async () => {
      // The control: the project named in the path is real and holds a chart
      // its own key can read, so the refusal below is about the credential
      // rather than about a missing project.
      const theirs = await createChart(otherProject, { name: "Theirs" });
      expect(await listedIds(otherProject)).toEqual([theirs.id]);

      const refusal = await refused({
        path: chartsPath(otherProject),
        auth: asProject(openProject),
      });
      expect(refusal.error.code).toBe("project_not_found");
    });
  });

  describe("when the key may view analytics and nothing more", () => {
    /** @scenario "A key that may read charts may not write them" */
    it("reads successfully and is refused on every write, before the service is reached", async () => {
      const existing = await createChart(openProject, { name: "Volume" });

      const listed = await succeeds({
        path: chartsPath(openProject),
        auth: asViewOnly(openProject),
      });
      expect((listed.data as Body[]).map((chart) => chart.id)).toEqual([
        existing.id,
      ]);
      const read = await succeeds({
        path: chartPath(openProject, existing.id),
        auth: asViewOnly(openProject),
      });
      expect(read.name).toBe("Volume");

      for (const [method, body] of [
        ["POST", { name: "Theirs", definition: DEFINITION }],
        ["PATCH", { name: "Renamed" }],
        ["DELETE", undefined],
      ] as const) {
        const path =
          method === "POST"
            ? chartsPath(openProject)
            : chartPath(openProject, existing.id);
        const refusal = await refused({
          path,
          method,
          auth: asViewOnly(openProject),
          ...(body === undefined ? {} : { body }),
        });
        expect(refusal.error.code, method).toBe("api_key_permission_denied");
      }

      // Nothing the refused writes attempted actually happened.
      const after = await succeeds({
        path: chartPath(openProject, existing.id),
        auth: asProject(openProject),
      });
      expect(after.name).toBe("Volume");
      expect(await listedIds(openProject)).toEqual([existing.id]);
    });
  });

  describe("when a stored definition does not match the versioned schema", () => {
    /** @scenario "A stored definition this build cannot read is refused, not returned as data" */
    it("refuses as an internal error rather than returning the raw stored payload", async () => {
      const stored = await prisma.customGraph.create({
        data: {
          id: `chart-unreadable-${ns}`,
          projectId: openProject.id,
          name: "Written by a build that disagreed",
          // Structurally a chart, but not this build's chart: no version, and
          // the fields under a name the parser does not know.
          graph: { spec: { mark: "bar" }, query: "SELECT 1" },
          kind: WORKBENCH_SQL_CHART_KIND,
        },
      });

      for (const path of [
        chartPath(openProject, stored.id),
        chartsPath(openProject),
      ]) {
        const response = await call({ path, auth: asProject(openProject) });
        const body = (await response.json()) as Body;
        expect(response.status, path).toBe(500);
        // `saved_workbench_chart_definition_invalid` is a 5xx `platform` fault,
        // and the canonical envelope answers every 5xx as `internal_error` with
        // a generic sentence on purpose — a platform failure's detail is not
        // API copy. The named code stays server-side, correlated by the trace
        // ids the envelope carries. Asserted rather than skipped because the
        // alternative outcome this rules out is a 200 carrying the raw row.
        expect(body.error.code, path).toBe("internal_error");
        expect(body.error.type, path).toBe("internal_error");
        expect(
          JSON.stringify(body),
          "the unreadable payload reached the caller",
        ).not.toContain("SELECT 1");
      }
    });
  });

  describe("when an update carries neither a name nor a definition", () => {
    /** @scenario "An update naming neither a name nor a definition is refused rather than quietly doing nothing" */
    it("refuses rather than answering as though something changed", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const refusal = await refused({
        path: chartPath(openProject, created.id),
        method: "PATCH",
        auth: asProject(openProject),
        body: {},
      });
      expect(refusal.error.code).toBe("validation_error");

      const after = await succeeds({
        path: chartPath(openProject, created.id),
        auth: asProject(openProject),
      });
      expect(after.name).toBe("Volume");
      expect(after.updatedAt).toBe(created.updatedAt);
    });

    /** @scenario "An update naming neither a name nor a definition is refused rather than quietly doing nothing" */
    it("accepts a rename on its own, keeping the definition it was saved with", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const renamed = await succeeds({
        path: chartPath(openProject, created.id),
        method: "PATCH",
        auth: asProject(openProject),
        body: { name: "Volume, renamed" },
      });
      expect(renamed.name).toBe("Volume, renamed");
      expect(renamed.definition.sql).toBe(SQL);
      expect(renamed.definition.vegaLiteSpec).toEqual(SPEC);
    });
  });

  describe("when a chart is deleted", () => {
    /** @scenario "Deleting a chart answers with no content and empties the listing" */
    it("answers 204 with no body, empties the listing, and refuses a second delete", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const response = await call({
        path: chartPath(openProject, created.id),
        method: "DELETE",
        auth: asProject(openProject),
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");

      expect(await listedIds(openProject)).toEqual([]);

      const again = await refused({
        path: chartPath(openProject, created.id),
        method: "DELETE",
        auth: asProject(openProject),
      });
      expect(again.error.code).toBe("saved_workbench_chart_not_found");
    });
  });

  describe("when the caller presents no credential", () => {
    it("refuses before any chart is considered", async () => {
      const response = await app.request(chartsPath(openProject));
      expect(response.status).toBe(401);
    });
  });
});

/**
 * The saved workbench chart endpoints, driven through the family this process
 * mounts, over a real Postgres.
 *
 * Every request goes through the process's own REST enforcement — the
 * credential chain, the API-key ceiling, the feature switch, the validator, the
 * service and both of its governors. What is seeded rather than stored is the
 * credential directory: `RestAuthWorld` answers the three services the chain
 * composes over, and the rows a chart lives in are real.
 *
 * No ClickHouse: nothing in this slice executes a statement. The LangWatchQL
 * validator is consulted for a verdict, which it reaches from the catalog and
 * the caller's protections alone, so a chart can be saved on a deployment that
 * could not run it — and the suite proves the gate rather than the database.
 *
 * Three habits, each answering a way this kind of suite goes quietly vacuous:
 *
 *  - Every "nothing was written" claim is paired with the listing that would
 *    have shown it. A refusal on its own passes against a handler that wrote
 *    first and threw afterwards.
 *  - Every refusal is asserted by `code`, never by message prose.
 *  - Three projects in two organizations throughout, so an isolation assertion
 *    has something to fail on.
 *
 * The family publishes the canonical error envelope, so a refusal is read at
 * `body.error.code` and its structured detail at `body.error.meta`.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see specs/analytics/lwql-langy-authoring.feature — the placement routes
 * @see specs/analytics/dashboard-rest-api.feature — the chart-kind isolation
 *   the dashboard family owes the same rows
 *
 * @integration
 * @vitest-environment node
 */
import {
  WORKBENCH_SQL_CHART_KIND,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { LangWatchQLService, lwqlEnabled } from "@langwatch/analytics-server";
import {
  AnalyticsSavedWorkbenchChartPolicyAdapter,
  createDashboardsRestApp,
  DashboardApp,
  PostgresDashboardAdapter,
  WorkbenchAccessPort,
  WorkbenchAwareGraphVisibilityAdapter,
  type DashboardGraphAlertLookup,
} from "@langwatch/dashboard-server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  RestAuthWorld,
  type RestAuthProject,
} from "../../../app-rest/__tests__/support/rest-auth.world";
import { mountLangWatchQLRest } from "../langwatch-ql-rest.mount";
import { mountQueryRest } from "../query-rest.mount";

/** Names a LangWatchQL dataset every deployment publishes, and reads nothing gated. */
const SQL = "SELECT count() AS value FROM analytics.traces WHERE OccurredAt >= {since:DateTime}";

/** Names a column the gated project's protections withhold. */
const GATED_SQL = "SELECT CapturedInput FROM analytics.traces";

const SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
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
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { url: "https://example.invalid/rows.json" },
  mark: "bar",
};

type Body = Record<string, any>;

const ns = nanoid(8);
const ORGANIZATION_SLUG = `saved-charts-${ns}`;
const OTHER_ORGANIZATION_SLUG = `saved-charts-other-${ns}`;

/** Test rows only; the guard the application ships is the application's business. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for the saved workbench chart REST suite");
  }
  return connection.client;
}

/**
 * A LangWatchQL service with no restricted identity.
 *
 * This family never executes, and a validator refusal must arrive before an
 * executor is ever consulted.
 */
function validatorOnlyLangWatchQL(): LangWatchQLService {
  return new LangWatchQLService({ executor: null, database: "analytics" });
}

const NO_GRAPH_ALERTS: DashboardGraphAlertLookup = {
  async getByCustomGraphIds() {
    return [];
  },
  async tryGetByCustomGraphId() {
    return null;
  },
};

/** Organizations the workbench switch is on for. The rest of the fleet is dark. */
let enabledOrganizationIds = new Set<string>();

function featureFlags(): FeatureFlagService {
  return {
    isEnabled: async (_flag: string, context: { organizationId?: string | undefined }) =>
      context.organizationId !== undefined && enabledOrganizationIds.has(context.organizationId),
  } as unknown as FeatureFlagService;
}

/** Content protections per project. The gated project withholds captured content. */
const protectionsByProject = new Map<string, LangWatchQLProtections>();

function protectionsFor({ projectId }: { projectId: string }): Promise<LangWatchQLProtections> {
  return Promise.resolve(
    protectionsByProject.get(projectId) ?? {
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
  );
}

const ORGANIZATION_ID = `org-${ns}`;
const OTHER_ORGANIZATION_ID = `org-other-${ns}`;
const TEAM_ID = `team-${ns}`;
const OTHER_TEAM_ID = `team-other-${ns}`;

/** Fully permitted. */
const openProject: RestAuthProject = {
  id: `project-open-${ns}`,
  name: "Open",
  slug: `open-${ns}`,
  teamId: TEAM_ID,
  organizationId: ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
};
/** Content-gated: its protections withhold captured input and output. */
const gatedProject: RestAuthProject = {
  id: `project-gated-${ns}`,
  name: "Gated",
  slug: `gated-${ns}`,
  teamId: TEAM_ID,
  organizationId: ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
};
/** Another organization entirely, so tenancy has a real boundary to cross. */
const otherProject: RestAuthProject = {
  id: `project-other-${ns}`,
  name: "Other",
  slug: `other-${ns}`,
  teamId: OTHER_TEAM_ID,
  organizationId: OTHER_ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
};

const KEY_OF: Record<string, string> = {
  [openProject.id]: `sk-open-${ns}`,
  [gatedProject.id]: `sk-gated-${ns}`,
  [otherProject.id]: `sk-other-${ns}`,
};
/** A key whose ceiling is `analytics:view` and nothing else. */
const VIEW_ONLY_KEY = `sk-view-only-${ns}`;

const world = RestAuthWorld.create({
  projects: [openProject, gatedProject, otherProject],
  keys: [
    { token: KEY_OF[openProject.id]!, projectId: openProject.id },
    { token: KEY_OF[gatedProject.id]!, projectId: gatedProject.id },
    { token: KEY_OF[otherProject.id]!, projectId: otherProject.id },
    { token: VIEW_ONLY_KEY, projectId: openProject.id, grants: ["analytics:view"] },
  ],
});

function projects(): ProjectService {
  return {
    getById: async (projectId: string) => ({ id: projectId, lwqlKey: `lwql-${projectId}` }),
    getOrganizationId: async (projectId: string) =>
      [openProject, gatedProject, otherProject].find((project) => project.id === projectId)
        ?.organizationId ?? null,
  } as unknown as ProjectService;
}

function dashboardApp(): DashboardApp {
  const langWatchQL = validatorOnlyLangWatchQL();
  return DashboardApp.create({
    dashboard: PostgresDashboardAdapter.create({
      database: database(),
      ids: { generate: () => `chart-${nanoid()}` },
      savedWorkbenchChartPolicy: AnalyticsSavedWorkbenchChartPolicyAdapter.create({ langWatchQL }),
      graphVisibility: WorkbenchAwareGraphVisibilityAdapter.create({
        workbenchAccess: new TestWorkbenchAccess(),
      }),
      langWatchQL,
    }).build(),
    automation: NO_GRAPH_ALERTS,
  });
}

class TestWorkbenchAccess extends WorkbenchAccessPort {
  isWorkbenchEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    return lwqlEnabled({ featureFlags: featureFlags(), projectId, projects: projects() });
  }
}

const describeWithDatabase = describe.skipIf(connection === null);

describeWithDatabase("given the saved workbench chart REST endpoints", () => {
  let charts: { request: (path: string, init?: RequestInit) => Promise<Response> };
  let query: { request: (path: string, init?: RequestInit) => Promise<Response> };
  let dashboards: { request: (path: string, init?: RequestInit) => Promise<Response> };
  let dashboard: DashboardApp;

  const chartsPath = (project: RestAuthProject) =>
    `/api/v1/projects/${project.id}/analytics/charts`;
  const chartPath = (project: RestAuthProject, chartId: string) =>
    `${chartsPath(project)}/${chartId}`;
  const placementPath = (project: RestAuthProject, chartId: string) =>
    `${chartPath(project, chartId)}/placement`;

  /** Runs one request with the switch off for every organization. */
  const withFlagOff = async <T>(request: () => Promise<T>): Promise<T> => {
    const enabled = enabledOrganizationIds;
    enabledOrganizationIds = new Set();
    try {
      return await request();
    } finally {
      enabledOrganizationIds = enabled;
    }
  };

  /** A dashboard owned by the given project, straight into the store. */
  const createDashboard = async (owner: RestAuthProject) =>
    await database().dashboard.create({
      data: {
        id: `dashboard-${nanoid()}`,
        name: `Placement dashboard ${nanoid(6)}`,
        projectId: owner.id,
        order: 0,
      },
    });

  /** The credential a request presents: a project's own key, unless told otherwise. */
  const asProject = (project: RestAuthProject) => RestAuthWorld.bearer(KEY_OF[project.id]!);
  const asViewOnly = () => RestAuthWorld.bearer(VIEW_ONLY_KEY);

  const call = (options: {
    path: string;
    method?: string;
    body?: unknown;
    auth: Record<string, string>;
    app?: { request: (path: string, init?: RequestInit) => Promise<Response> };
  }) =>
    (options.app ?? charts).request(options.path, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", ...options.auth },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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
  const refused = async (options: Parameters<typeof call>[0]): Promise<Body> => {
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
    project: RestAuthProject,
    overrides: { name?: string; definition?: unknown } = {},
  ): Promise<Body> =>
    await succeeds({
      path: chartsPath(project),
      method: "POST",
      auth: asProject(project),
      status: 201,
      body: {
        name: overrides.name ?? "Traces per day",
        definition: overrides.definition === undefined ? DEFINITION : overrides.definition,
      },
    });

  /** The ids the project's own key can see, in listing order. */
  const listedIds = async (project: RestAuthProject): Promise<string[]> => {
    const body = await succeeds({ path: chartsPath(project), auth: asProject(project) });
    return (body.data as Body[]).map((chart) => chart.id);
  };

  /** The chart's placement as its own key reads it back. */
  const placementOf = async (project: RestAuthProject, chartId: string): Promise<Body> => {
    const read = await succeeds({ path: chartPath(project, chartId), auth: asProject(project) });
    return {
      dashboardId: read.dashboardId,
      gridColumn: read.gridColumn,
      gridRow: read.gridRow,
      colSpan: read.colSpan,
      rowSpan: read.rowSpan,
    };
  };

  beforeAll(async () => {
    const prisma = database();
    await prisma.organization.create({
      data: { id: ORGANIZATION_ID, name: "Saved charts org", slug: ORGANIZATION_SLUG },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: "Saved charts team",
        slug: ORGANIZATION_SLUG,
        organizationId: ORGANIZATION_ID,
      },
    });
    await prisma.organization.create({
      data: { id: OTHER_ORGANIZATION_ID, name: "Other org", slug: OTHER_ORGANIZATION_SLUG },
    });
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        name: "Other team",
        slug: OTHER_ORGANIZATION_SLUG,
        organizationId: OTHER_ORGANIZATION_ID,
      },
    });
    for (const project of [openProject, gatedProject, otherProject]) {
      await prisma.project.create({
        data: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          apiKey: KEY_OF[project.id]!,
          teamId: project.teamId,
          language: "typescript",
          framework: "other",
        },
      });
    }

    protectionsByProject.set(gatedProject.id, {
      canSeeCosts: true,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
    });
    enabledOrganizationIds = new Set([ORGANIZATION_ID, OTHER_ORGANIZATION_ID]);

    dashboard = dashboardApp();
    const security = world.security();
    const collaborators = {
      featureFlags,
      projects,
      langWatchQL: validatorOnlyLangWatchQL,
      protectionsFor,
    };
    charts = fetcher(
      new Hono().route(
        "/",
        mountLangWatchQLRest({
          security,
          collaborators,
          dashboard: () => dashboard,
          publicBaseUrl: "https://app.langwatch.test",
        }),
      ),
    );
    query = fetcher(new Hono().route("/", mountQueryRest({ security, collaborators })));
    dashboards = fetcher(
      new Hono().route(
        "/",
        createDashboardsRestApp({
          security,
          dashboard: () => dashboard,
          platformUrl: ({ path }: { projectSlug: string; path: string }) =>
            `https://app.langwatch.test${path}`,
        }).hono,
      ),
    );
  }, 120_000);

  afterEach(async () => {
    const prisma = database();
    const projectIds = [openProject.id, gatedProject.id, otherProject.id];
    await prisma.customGraph.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.dashboard.deleteMany({ where: { projectId: { in: projectIds } } });
  });

  afterAll(async () => {
    const prisma = database();
    const projectIds = [openProject.id, gatedProject.id, otherProject.id];
    await prisma.customGraph.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.dashboard.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.team.deleteMany({ where: { id: { in: [TEAM_ID, OTHER_TEAM_ID] } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID] } },
    });
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

      expect(body.error.code).toBe("saved_workbench_chart_specification_refused");
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
      expect(body.error.code).toBe("saved_workbench_chart_specification_refused");

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
        body: { name: "Withheld column", definition: { ...DEFINITION, sql: GATED_SQL } },
      });

      const running = await refused({
        app: query,
        path: "/api/v1/query",
        method: "POST",
        auth: asProject(gatedProject),
        body: { sql: GATED_SQL },
      });

      expect(saving.error.code).toBe("lwql_not_permitted");
      expect(running.error.code).toBe(saving.error.code);
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
     * thing that varies between the control and the refusal.
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
        body: { name: "Past the ceiling", definition: { ...DEFINITION, sql: paddedSql(400_000) } },
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
    /** @scenario "Every chart endpoint stays dark while the workbench switch is off" */
    it("refuses all five verbs with the named refusal", async () => {
      const created = await createChart(openProject, { name: "Volume" });

      const refusals = await withFlagOff(async () => [
        await refused({ path: chartsPath(openProject), auth: asProject(openProject) }),
        await refused({ path: chartPath(openProject, created.id), auth: asProject(openProject) }),
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

      expect(refusals.map((body) => body.error.code)).toEqual(Array(5).fill("lwql_not_enabled"));
      // Neither the write nor the delete happened while the surface was off.
      expect(await listedIds(openProject)).toEqual([created.id]);
    });
  });

  describe("when one organization is the only thing enabling the switch", () => {
    /**
     * One rule keyed to an organization: the surface is on exactly for that
     * organization's projects. The guard resolves the project's organization
     * and the rule matches it, which is the whole chain this claim is about.
     */
    const withOrganizationRule = async <T>(
      organizationId: string,
      request: () => Promise<T>,
    ): Promise<T> => {
      const enabled = enabledOrganizationIds;
      enabledOrganizationIds = new Set([organizationId]);
      try {
        return await request();
      } finally {
        enabledOrganizationIds = enabled;
      }
    };

    /** @scenario "The API's switch is decided for the project's organization" */
    it("answers for a project in the granted organization", async () => {
      const response = await withOrganizationRule(ORGANIZATION_ID, async () =>
        call({ path: chartsPath(openProject), auth: asProject(openProject) }),
      );
      expect(response.status).toBe(200);
    });

    /** @scenario "The API's switch is decided for the project's organization" */
    it("still refuses a project whose organization holds no grant", async () => {
      const response = await withOrganizationRule(OTHER_ORGANIZATION_ID, async () =>
        call({ path: chartsPath(openProject), auth: asProject(openProject) }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as Body).error.code).toBe("lwql_not_enabled");
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
        expect(refusal.error.code, method).toBe("saved_workbench_chart_not_found");
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

      const listed = await succeeds({ path: chartsPath(openProject), auth: asViewOnly() });
      expect((listed.data as Body[]).map((chart) => chart.id)).toEqual([existing.id]);
      const read = await succeeds({
        path: chartPath(openProject, existing.id),
        auth: asViewOnly(),
      });
      expect(read.name).toBe("Volume");

      for (const [method, body] of [
        ["POST", { name: "Theirs", definition: DEFINITION }],
        ["PATCH", { name: "Renamed" }],
        ["DELETE", undefined],
      ] as const) {
        const path =
          method === "POST" ? chartsPath(openProject) : chartPath(openProject, existing.id);
        const refusal = await refused({
          path,
          method,
          auth: asViewOnly(),
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
    it("refuses with the opaque 500 rather than returning the raw stored payload", async () => {
      const stored = await database().customGraph.create({
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

      for (const path of [chartPath(openProject, stored.id), chartsPath(openProject)]) {
        const response = await call({ path, auth: asProject(openProject) });
        const body = (await response.json()) as Body;
        expect(response.status, path).toBe(500);
        // Handled 5xx bodies are collapsed to the opaque `internal_error`
        // shape by the canonical envelope — a 5xx is the platform's fault, so
        // the body carries nothing for the caller to act on beyond trace ids.
        // Asserted rather than skipped because the alternative outcome this
        // rules out is a 200 carrying the raw row.
        expect(body.error.code, path).toBe("internal_error");
        expect(body.error.type, path).toBe("internal_error");
        expect(JSON.stringify(body), "the unreadable payload reached the caller").not.toContain(
          "SELECT 1",
        );
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

  describe("when an integration places a chart on a dashboard in its project", () => {
    /** @scenario "An integration places a saved chart on a dashboard over the API" */
    it("answers with the placed chart, and the placement reads back by id", async () => {
      const chart = await createChart(openProject, { name: "Placed" });
      const board = await createDashboard(openProject);

      const placed = await succeeds({
        path: placementPath(openProject, chart.id),
        method: "PUT",
        auth: asProject(openProject),
        body: { dashboardId: board.id, gridColumn: 0, gridRow: 3, colSpan: 2, rowSpan: 2 },
      });
      expect(placed.id).toBe(chart.id);
      expect(placed.dashboardId).toBe(board.id);
      expect(placed.gridColumn).toBe(0);
      expect(placed.gridRow).toBe(3);
      expect(placed.colSpan).toBe(2);
      expect(placed.rowSpan).toBe(2);

      expect(await placementOf(openProject, chart.id)).toEqual({
        dashboardId: board.id,
        gridColumn: 0,
        gridRow: 3,
        colSpan: 2,
        rowSpan: 2,
      });
    });

    /** @scenario "An integration unplaces a saved chart over the API" */
    it("unplaces with a 204, after which the chart reads back with no placement", async () => {
      const chart = await createChart(openProject, { name: "Unplaced" });
      const board = await createDashboard(openProject);
      await succeeds({
        path: placementPath(openProject, chart.id),
        method: "PUT",
        auth: asProject(openProject),
        body: { dashboardId: board.id, gridRow: 2 },
      });

      const response = await call({
        path: placementPath(openProject, chart.id),
        method: "DELETE",
        auth: asProject(openProject),
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");

      expect(await placementOf(openProject, chart.id)).toEqual({
        dashboardId: null,
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
      });
    });
  });

  describe("when the placement names a dashboard of another project", () => {
    /** @scenario "Placement onto a foreign dashboard is refused over the API the same way it is inside the application" */
    it("refuses with the dashboard-not-found code and writes no placement", async () => {
      const chart = await createChart(openProject, { name: "Stays put" });
      const foreignDashboard = await createDashboard(otherProject);
      const before = await placementOf(openProject, chart.id);

      const refusal = await refused({
        path: placementPath(openProject, chart.id),
        method: "PUT",
        auth: asProject(openProject),
        body: { dashboardId: foreignDashboard.id },
      });
      expect(refusal.error.code).toBe("saved_workbench_chart_dashboard_not_found");

      expect(await placementOf(openProject, chart.id)).toEqual(before);
    });
  });

  describe("when the placement names a chart id absent from this project", () => {
    /** @scenario "Placing an unknown chart id is refused as not found, indistinguishable from a foreign one" */
    it("answers the one not-found for a foreign id and a nonexistent one alike", async () => {
      const theirs = await createChart(otherProject, { name: "Theirs" });
      const board = await createDashboard(openProject);

      const refusals = [
        // Another project's real chart, and an id no project has ever held.
        await refused({
          path: placementPath(openProject, theirs.id),
          method: "PUT",
          auth: asProject(openProject),
          body: { dashboardId: board.id },
        }),
        await refused({
          path: placementPath(openProject, `never-${nanoid()}`),
          method: "PUT",
          auth: asProject(openProject),
          body: { dashboardId: board.id },
        }),
      ];
      expect(refusals.map((body) => body.error.code)).toEqual(
        Array(2).fill("saved_workbench_chart_not_found"),
      );

      // The foreign chart gained nothing from the attempt.
      expect(await placementOf(otherProject, theirs.id)).toMatchObject({ dashboardId: null });
    });
  });

  describe("when the switch is off for the project placing a chart", () => {
    /** @scenario "Placement routes stay dark while the workbench switch is off" */
    it("refuses both placement verbs with the named refusal, mutating nothing", async () => {
      const chart = await createChart(openProject, { name: "Dark" });
      const board = await createDashboard(openProject);
      const before = await placementOf(openProject, chart.id);

      const refusals = await withFlagOff(async () => [
        await refused({
          path: placementPath(openProject, chart.id),
          method: "PUT",
          auth: asProject(openProject),
          body: { dashboardId: board.id },
        }),
        await refused({
          path: placementPath(openProject, chart.id),
          method: "DELETE",
          auth: asProject(openProject),
        }),
      ]);
      expect(refusals.map((body) => body.error.code)).toEqual(Array(2).fill("lwql_not_enabled"));

      expect(await placementOf(openProject, chart.id)).toEqual(before);
    });
  });

  describe("when the key may view analytics and tries to place a chart", () => {
    /** @scenario "A key that may read charts may not place or unplace them" */
    it("is refused on both placement verbs before the service is reached", async () => {
      const chart = await createChart(openProject, { name: "Read-only" });
      const board = await createDashboard(openProject);
      const before = await placementOf(openProject, chart.id);

      for (const [method, body] of [
        ["PUT", { dashboardId: board.id }],
        ["DELETE", undefined],
      ] as const) {
        const refusal = await refused({
          path: placementPath(openProject, chart.id),
          method,
          auth: asViewOnly(),
          ...(body === undefined ? {} : { body }),
        });
        expect(refusal.error.code, method).toBe("api_key_permission_denied");
      }

      expect(await placementOf(openProject, chart.id)).toEqual(before);
    });
  });

  describe("when the caller presents no credential", () => {
    it("refuses before any chart is considered", async () => {
      const response = await charts.request(chartsPath(openProject));
      expect(response.status).toBe(401);
    });
  });

  // ── Chart-kind isolation on the dashboard family ───────────────────────────
  //
  // The REST reader serialises each graph row wholesale, so a workbench row
  // reaching it would publish a member's stored SQL to any project API key.

  describe("when a workbench chart is placed on the dashboard being read", () => {
    /**
     * Distinctive enough that a substring search over the whole serialised body
     * cannot miss it, and cannot match by coincidence.
     */
    const SECRET_SQL = "SELECT CapturedInput AS leaked_marker_7f3a FROM analytics.traces";

    const createBuilderGraph = async (dashboardId: string) =>
      await database().customGraph.create({
        data: {
          id: `graph-${nanoid()}`,
          projectId: openProject.id,
          dashboardId,
          name: `Graph ${nanoid(6)}`,
          graph: {},
          gridRow: 0,
          gridColumn: 0,
        },
      });

    /**
     * A saved LangWatchQL workbench chart placed on a dashboard. Its `graph`
     * column holds the member's statement, which is exactly what must not
     * appear in a REST response.
     */
    const createPlacedWorkbenchChart = async (dashboardId: string) =>
      await database().customGraph.create({
        data: {
          id: `chart-${nanoid()}`,
          projectId: openProject.id,
          dashboardId,
          name: `Workbench ${nanoid(6)}`,
          kind: WORKBENCH_SQL_CHART_KIND,
          graph: { version: 1, sql: SECRET_SQL, parameters: {} },
          gridRow: 0,
          gridColumn: 0,
        },
      });

    /** @scenario "A saved workbench chart is not exposed through the dashboard REST API" */
    it("omits the workbench chart from the graphs it returns", async () => {
      const board = await createDashboard(openProject);
      const builderGraph = await createBuilderGraph(board.id);
      await createPlacedWorkbenchChart(board.id);

      const response = await call({
        app: dashboards,
        path: `/api/dashboards/${board.id}`,
        auth: asProject(openProject),
      });
      expect(response.status).toBe(200);

      const body = (await response.json()) as Body;
      expect(body.graphs.map((graph: { id: string }) => graph.id)).toEqual([builderGraph.id]);
    });

    it("does not carry the stored statement anywhere in the response", async () => {
      const board = await createDashboard(openProject);
      await createBuilderGraph(board.id);
      await createPlacedWorkbenchChart(board.id);

      const response = await call({
        app: dashboards,
        path: `/api/dashboards/${board.id}`,
        auth: asProject(openProject),
      });
      expect(response.status).toBe(200);

      // Asserted over the whole body rather than over `graphs`: the claim is
      // that the SQL is not in the response at all, which a shape-scoped
      // assertion would not catch if a later field carried it.
      expect(await response.text()).not.toContain("leaked_marker_7f3a");
    });

    /** @scenario "The list's graphCount matches what the detail response actually returns" */
    it("does not count the workbench chart the detail response omits", async () => {
      const board = await createDashboard(openProject);
      await createBuilderGraph(board.id);
      await createPlacedWorkbenchChart(board.id);

      const detail = (await (
        await call({
          app: dashboards,
          path: `/api/dashboards/${board.id}`,
          auth: asProject(openProject),
        })
      ).json()) as Body;
      const listed = (await (
        await call({ app: dashboards, path: "/api/dashboards", auth: asProject(openProject) })
      ).json()) as Body;
      const row = (listed.data as Body[]).find((entry) => entry.id === board.id);

      // The list's count and the detail's array are two views of one resource
      // — a caller that reads graphCount and then fetches the detail must see
      // the same number of cards in both.
      expect(row?.graphCount).toBe(detail.graphs.length);
      expect(row?.graphCount).toBe(1);
    });
  });

  // ── Langy's CLI, at the wire ────────────────────────────────────────────────
  //
  // The `langwatch chart` family is a thin typed client over these endpoints;
  // its flag-to-request mapping is pinned by the SDK's own unit suite. These
  // cases prove the half the CLI cannot: the requests it emits land in the same
  // rows, refusals and governors as every other path.

  describe("given Langy drives the chart CLI against the API", () => {
    /** The exact body `langwatch chart create --name … --sql-file … --param … --spec-file …` sends. */
    const cliCreateBody = (name: string) => ({
      name,
      definition: {
        version: 1,
        sql: SQL,
        parameters: { since: "2026-02-01 00:00:00" },
        vegaLiteSpec: SPEC,
      },
    });

    describe("when it creates a chart and reads it back by id", () => {
      /** @scenario "Langy creates a chart with the CLI and reads it back with the same query, parameters and specification" */
      it("returns the submitted SQL, parameter values and specification unchanged", async () => {
        const created = await succeeds({
          path: chartsPath(openProject),
          method: "POST",
          auth: asProject(openProject),
          status: 201,
          body: cliCreateBody("Langy's chart"),
        });

        const read = await succeeds({
          path: chartPath(openProject, created.id),
          auth: asProject(openProject),
        });
        expect(read.definition.sql).toBe(SQL);
        expect(read.definition.parameters).toEqual({ since: "2026-02-01 00:00:00" });
        expect(read.definition.vegaLiteSpec).toEqual(SPEC);
      });
    });

    describe("when its chart is compared against one saved through the application", () => {
      /** @scenario "A chart Langy creates is indistinguishable from one a member saves by hand" */
      it("stores a row equal on kind, definition shape and project scoping", async () => {
        const viaCli = await succeeds({
          path: chartsPath(openProject),
          method: "POST",
          auth: asProject(openProject),
          status: 201,
          body: cliCreateBody("Langy's twin"),
        });

        // The application's own save path: the service the tRPC router calls,
        // with the member's protections resolved the same way.
        const viaApplication = await dashboard.createSavedWorkbenchChart({
          projectId: openProject.id,
          protections: await protectionsFor({ projectId: openProject.id }),
          name: "Member's twin",
          definition: cliCreateBody("unused").definition,
        });

        const rows = await database().customGraph.findMany({
          where: { projectId: openProject.id, id: { in: [viaCli.id, viaApplication.id] } },
        });
        expect(rows).toHaveLength(2);
        const [first, second] = rows as unknown as [Body, Body];
        expect(first.kind).toBe(WORKBENCH_SQL_CHART_KIND);
        expect(second.kind).toBe(WORKBENCH_SQL_CHART_KIND);
        expect(first.graph).toEqual(second.graph);
        expect(first.projectId).toBe(second.projectId);
      });
    });

    describe("when its credentials cannot read a column the SQL names", () => {
      /** @scenario "SQL naming a column Langy's credentials cannot read is refused identically everywhere" */
      it("is refused with the same validator code via the CLI's wire, REST directly, and the application's save path", async () => {
        // The CLI's wire: the chart-create request `langwatch chart create` emits.
        const viaCli = await refused({
          path: chartsPath(gatedProject),
          method: "POST",
          auth: asProject(gatedProject),
          body: { name: "Withheld, via CLI", definition: { ...DEFINITION, sql: GATED_SQL } },
        });

        // REST directly: the governed query door with the same statement.
        const viaRest = await refused({
          app: query,
          path: "/api/v1/query",
          method: "POST",
          auth: asProject(gatedProject),
          body: { sql: GATED_SQL },
        });

        // The application's own save path.
        let viaApplication: string | undefined;
        try {
          await dashboard.createSavedWorkbenchChart({
            projectId: gatedProject.id,
            protections: await protectionsFor({ projectId: gatedProject.id }),
            name: "Withheld, via application",
            definition: { ...DEFINITION, sql: GATED_SQL },
          });
        } catch (error) {
          viaApplication = (error as { code?: string }).code;
        }

        expect(viaCli.error.code).toBe("lwql_not_permitted");
        expect(viaRest.error.code).toBe(viaCli.error.code);
        expect(viaApplication).toBe(viaCli.error.code);
      });
    });

    describe("when it submits a specification the chart policy refuses", () => {
      /** @scenario "A specification the chart policy refuses cannot be written through the CLI" */
      it("answers the specification-refused code, and no chart is created", async () => {
        const before = await listedIds(openProject);

        const refusal = await refused({
          path: chartsPath(openProject),
          method: "POST",
          auth: asProject(openProject),
          body: {
            name: "Network-loading spec via CLI",
            definition: { ...DEFINITION, vegaLiteSpec: NETWORK_SPEC },
          },
        });
        expect(refusal.error.code).toBe("saved_workbench_chart_specification_refused");

        expect(await listedIds(openProject)).toEqual(before);
      });
    });

    describe("when it places a saved chart on a dashboard", () => {
      /** @scenario "Langy places a saved chart on a dashboard with the CLI" */
      it("sets the dashboard id and grid position, and the chart lists among the dashboard's charts", async () => {
        const chart = await createChart(openProject, { name: "Langy placed this" });
        const board = await createDashboard(openProject);

        // The exact request `langwatch chart place <id> --dashboard-id <d>` emits.
        const placed = await succeeds({
          path: placementPath(openProject, chart.id),
          method: "PUT",
          auth: asProject(openProject),
          body: { dashboardId: board.id },
        });
        expect(placed.dashboardId).toBe(board.id);
        expect(typeof placed.gridRow).toBe("number");

        const dashboardCharts = await database().customGraph.findMany({
          where: { projectId: openProject.id, dashboardId: board.id },
          select: { id: true },
        });
        expect(dashboardCharts.map((row) => row.id)).toContain(chart.id);
      });
    });
  });
});

function fetcher(hono: Hono): {
  request: (path: string, init?: RequestInit) => Promise<Response>;
} {
  return {
    request: async (path: string, init?: RequestInit) =>
      await hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

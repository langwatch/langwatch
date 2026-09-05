/**
 * The saved-chart tRPC surface as this process mounts it, against a real
 * Postgres.
 *
 * The rows are real, the service and both of its governors are real, and the
 * permission each procedure requires is the one the router itself declares —
 * the host's check reads that declaration and refuses against the caller's own
 * grants, so "a member who may read cannot write" is decided by the router's
 * declarations rather than by a mock told what to answer.
 *
 * The rollout switch is the process's own port, so the switched-off case
 * exercises the same gate the composition installs.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 *
 * @integration
 * @vitest-environment node
 */
import { WORKBENCH_SQL_CHART_KIND } from "@langwatch/analytics-contract";
import { LangWatchQLNotEnabledError, LangWatchQLService } from "@langwatch/analytics-server";
import {
  authzDeclarationOf,
  declareAuthzMiddleware,
  PermissionDeniedError,
  type AuthzDeclaration,
} from "@langwatch/authz-contract";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import {
  AnalyticsSavedWorkbenchChartPolicyAdapter,
  DashboardApp,
  mapDashboardSavedWorkbenchChartError,
  PostgresDashboardAdapter,
  WorkbenchAccessPort,
  WorkbenchAwareGraphVisibilityAdapter,
  type DashboardGraphAlertLookup,
} from "@langwatch/dashboard-server";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { initTRPC } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createSavedWorkbenchChartTrpcRouter } from "../../dashboard/dashboard-trpc.mount";

const SQL = "SELECT count() AS value FROM analytics.traces WHERE OccurredAt >= {since:DateTime}";

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

/** Loads its data over the network — the chart policy refuses it. */
const NETWORK_SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { url: "https://example.invalid/rows.json" },
  mark: "bar",
};

const ns = nanoid(8);
const ORGANIZATION_ID = `org-swbc-${ns}`;
const TEAM_ID = `team-swbc-${ns}`;
const PROJECT = `proj-swbc-${ns}`;
const OTHER_PROJECT = `proj-swbc-other-${ns}`;

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
    throw new Error("DATABASE_URL is required for the saved workbench chart tRPC suite");
  }
  return connection.client;
}

const NO_GRAPH_ALERTS: DashboardGraphAlertLookup = {
  async getByCustomGraphIds() {
    return [];
  },
  async tryGetByCustomGraphId() {
    return null;
  },
};

/** Whether the workbench switch is on. Flipped by the switched-off case. */
let workbenchEnabled = true;

class TestWorkbenchAccess extends WorkbenchAccessPort {
  async isWorkbenchEnabled(): Promise<boolean> {
    return workbenchEnabled;
  }
}

/**
 * A LangWatchQL service with no restricted identity. Nothing here executes:
 * `run` is not among the procedures these cases drive, and a validator refusal
 * arrives before an executor is consulted.
 */
function validatorOnlyLangWatchQL(): LangWatchQLService {
  return new LangWatchQLService({ executor: null, database: "analytics" });
}

type Context = Readonly<{ app: Readonly<{ dashboard: DashboardApp }> }>;

function declarationsOf(router: unknown): Record<string, AuthzDeclaration | null> {
  const procedures = (router as { _def: { procedures: Record<string, unknown> } })._def.procedures;
  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => {
      const middlewares =
        (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ?? [];
      const declared =
        middlewares.map((middleware) => authzDeclarationOf(middleware)).find((f) => f !== null) ??
        null;
      return [path, declared];
    }),
  );
}

/**
 * The host policy, with the authorization check reading the router's own
 * declaration and refusing against this caller's grants. Nothing here decides
 * which permission a procedure needs — the router does.
 */
function policyMiddlewares(grants: () => ReadonlySet<string>): AppTrpcPolicyMiddlewares {
  const pass = ({ next }: { next: () => Promise<unknown> }) => next();
  return {
    tracer: pass,
    logger: pass,
    handledError: pass,
    scopeLineageGuard: () => pass,
    declaredCheck: (declaration) =>
      declareAuthzMiddleware(declaration, (({
        input,
        next,
      }: {
        input: unknown;
        next: () => Promise<unknown>;
      }) => {
        const permission = declaration.kind === "permission" ? declaration.permission : undefined;
        if (permission !== undefined && !grants().has(permission)) {
          throw new PermissionDeniedError({
            permission,
            scope: { type: "project", id: (input as { projectId: string }).projectId },
            denialReason: "no-binding",
          });
        }
        return next();
      }) as unknown as (params: never) => Promise<unknown>),
    enforceCheck: pass,
    auditMutations: pass,
  } as AppTrpcPolicyMiddlewares;
}

const describeWithDatabase = describe.skipIf(connection === null);

describeWithDatabase("given the saved-chart tRPC surface this process mounts", () => {
  let dashboard: DashboardApp;

  /** The permissions the caller currently holds. Swapped per case. */
  let grants: ReadonlySet<string> = new Set();

  const ALL_CHART_PERMISSIONS = new Set([
    "analytics:view",
    "analytics:create",
    "analytics:update",
    "analytics:delete",
  ]);

  function router() {
    const trpc = initTRPC.context<Context>().create();
    return createSavedWorkbenchChartTrpcRouter({
      root: trpc,
      protectedProcedure: trpc.procedure,
      middlewares: policyMiddlewares(() => grants),
      ports: {
        requireWorkbenchEnabled: <TProcedure>(procedure: TProcedure): TProcedure =>
          (procedure as unknown as { use: (fn: unknown) => TProcedure }).use(
            async ({ next }: { next: () => unknown }) => {
              if (!workbenchEnabled) throw new LangWatchQLNotEnabledError();
              return next();
            },
          ),
        timeWindowSchema: z.any(),
        granularityStepSchema: z.number(),
        resolveProtections: async () => ({
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        }),
        resolveRunCaller: async (_ctx, input) => ({
          project: { id: input.projectId, lwqlKey: `lwql-${input.projectId}` },
          protections: {
            canSeeCosts: true,
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
          },
        }),
        admitDefinition: (_ctx, input) => input.definition,
        mapError: (error) => mapDashboardSavedWorkbenchChartError(error),
      },
    });
  }

  function caller() {
    return router().createCaller({ app: { dashboard } });
  }

  /** The `code` a refused call carried, or the fact that it was not refused. */
  const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (error) {
      const handled = (error as { cause?: { code?: string }; code?: string }).cause?.code;
      return handled ?? (error as { code?: string }).code ?? "unknown";
    }
    return "not refused";
  };

  const saveChart = async (name = "Traces per day") => {
    const previous = grants;
    grants = ALL_CHART_PERMISSIONS;
    try {
      return (await caller().create({ projectId: PROJECT, name, definition: DEFINITION })) as {
        id: string;
        name: string;
      };
    } finally {
      grants = previous;
    }
  };

  beforeAll(async () => {
    const prisma = database();
    await prisma.organization.create({
      data: { id: ORGANIZATION_ID, name: "Saved chart tRPC", slug: `swbc-${ns}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: "Saved chart tRPC",
        slug: `swbc-${ns}`,
        organizationId: ORGANIZATION_ID,
      },
    });
    for (const [id, slug] of [
      [PROJECT, `swbc-${ns}`],
      [OTHER_PROJECT, `swbc-other-${ns}`],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: slug,
          slug,
          apiKey: `key-${slug}`,
          teamId: TEAM_ID,
          language: "typescript",
          framework: "other",
        },
      });
    }

    const langWatchQL = validatorOnlyLangWatchQL();
    dashboard = DashboardApp.create({
      dashboard: PostgresDashboardAdapter.create({
        database: prisma,
        ids: { generate: () => `chart-${nanoid()}` },
        savedWorkbenchChartPolicy: AnalyticsSavedWorkbenchChartPolicyAdapter.create({
          langWatchQL,
        }),
        graphVisibility: WorkbenchAwareGraphVisibilityAdapter.create({
          workbenchAccess: new TestWorkbenchAccess(),
        }),
        langWatchQL,
      }).build(),
      automation: NO_GRAPH_ALERTS,
    });
  }, 120_000);

  afterEach(async () => {
    workbenchEnabled = true;
    grants = new Set();
    await database().customGraph.deleteMany({
      where: { projectId: { in: [PROJECT, OTHER_PROJECT] } },
    });
  });

  afterAll(async () => {
    const prisma = database();
    await prisma.customGraph.deleteMany({
      where: { projectId: { in: [PROJECT, OTHER_PROJECT] } },
    });
    await prisma.project.deleteMany({ where: { id: { in: [PROJECT, OTHER_PROJECT] } } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
  });

  describe("given the workbench switch is off for the project", () => {
    describe("when the member reaches any of the procedures", () => {
      /** @scenario "Saved charts stay unreachable while the workbench switch is off" */
      it("refuses every one of them the same way", async () => {
        const saved = await saveChart();
        grants = ALL_CHART_PERMISSIONS;
        workbenchEnabled = false;

        expect(await refusalOf(() => caller().getAll({ projectId: PROJECT }))).toBe(
          "lwql_not_enabled",
        );
        expect(await refusalOf(() => caller().getById({ projectId: PROJECT, id: saved.id }))).toBe(
          "lwql_not_enabled",
        );
        expect(
          await refusalOf(() =>
            caller().create({ projectId: PROJECT, name: "Another", definition: DEFINITION }),
          ),
        ).toBe("lwql_not_enabled");
        expect(
          await refusalOf(() =>
            caller().update({ projectId: PROJECT, id: saved.id, name: "Renamed" }),
          ),
        ).toBe("lwql_not_enabled");
        expect(await refusalOf(() => caller().delete({ projectId: PROJECT, id: saved.id }))).toBe(
          "lwql_not_enabled",
        );
      });
    });
  });

  describe("given a member who may view analytics but not change them", () => {
    describe("when they list charts and then try to write", () => {
      /** @scenario "Being allowed to read a chart is not being allowed to change one" */
      it("lets the listing through and refuses each write for want of its own permission", async () => {
        const saved = await saveChart();
        grants = new Set(["analytics:view"]);

        // The read they are entitled to.
        expect(
          ((await caller().getAll({ projectId: PROJECT })) as { id: string }[]).map(({ id }) => id),
        ).toEqual([saved.id]);

        // Each write, refused on its own permission rather than on the read one.
        expect(
          await refusalOf(() =>
            caller().create({ projectId: PROJECT, name: "Theirs", definition: DEFINITION }),
          ),
        ).toBe("permission_denied");
        expect(
          await refusalOf(() =>
            caller().update({ projectId: PROJECT, id: saved.id, name: "Renamed" }),
          ),
        ).toBe("permission_denied");
        expect(await refusalOf(() => caller().delete({ projectId: PROJECT, id: saved.id }))).toBe(
          "permission_denied",
        );

        // Nothing the refused writes attempted actually happened.
        const after = (await caller().getById({ projectId: PROJECT, id: saved.id })) as {
          name: string;
        };
        expect(after.name).toBe("Traces per day");
        expect(((await caller().getAll({ projectId: PROJECT })) as unknown[]).length).toBe(1);
      });
    });
  });

  describe("given a member holding no analytics permission", () => {
    describe("when they reach for this project's charts", () => {
      /** @scenario "Reading saved charts requires the analytics permission" */
      it("is refused before any chart is read", async () => {
        await saveChart();
        grants = new Set(["traces:view"]);

        expect(await refusalOf(() => caller().getAll({ projectId: PROJECT }))).toBe(
          "permission_denied",
        );
      });
    });
  });

  describe("given a chart saved in another project", () => {
    describe("when the member names its id on their own project", () => {
      /** @scenario "Every procedure answers only for the project in the request" */
      it("answers not found, exactly as for an id that never existed", async () => {
        grants = ALL_CHART_PERMISSIONS;
        const theirs = (await caller().create({
          projectId: OTHER_PROJECT,
          name: "Theirs",
          definition: DEFINITION,
        })) as { id: string; name: string };

        expect(await refusalOf(() => caller().getById({ projectId: PROJECT, id: theirs.id }))).toBe(
          "saved_workbench_chart_not_found",
        );
        expect(
          await refusalOf(() => caller().getById({ projectId: PROJECT, id: `never-${nanoid()}` })),
        ).toBe("saved_workbench_chart_not_found");
        expect(
          await refusalOf(() =>
            caller().update({ projectId: PROJECT, id: theirs.id, name: "Mine now" }),
          ),
        ).toBe("saved_workbench_chart_not_found");
        expect(await refusalOf(() => caller().delete({ projectId: PROJECT, id: theirs.id }))).toBe(
          "saved_workbench_chart_not_found",
        );

        // Still theirs, still named what they named it.
        expect(
          (
            (await caller().getById({ projectId: OTHER_PROJECT, id: theirs.id })) as {
              name: string;
            }
          ).name,
        ).toBe("Theirs");
      });
    });
  });

  describe("given a definition the governors refuse", () => {
    describe("when the member saves it through the application", () => {
      /** @scenario "A refusal from the write gate reaches the member with its code intact" */
      it("delivers the service's own code rather than a generic failure", async () => {
        grants = ALL_CHART_PERMISSIONS;

        expect(
          await refusalOf(() =>
            caller().create({
              projectId: PROJECT,
              name: "Loads over the network",
              definition: { ...DEFINITION, vegaLiteSpec: NETWORK_SPEC },
            }),
          ),
        ).toBe("saved_workbench_chart_specification_refused");

        expect(
          await refusalOf(() =>
            caller().create({
              projectId: PROJECT,
              name: "A write dressed as a chart",
              definition: { ...DEFINITION, sql: "DROP TABLE analytics.traces" },
            }),
          ),
        ).toBe("lwql_not_permitted");

        expect(
          await refusalOf(() =>
            caller().create({ projectId: PROJECT, name: "Shapeless", definition: { sql: SQL } }),
          ),
        ).toBe("validation_error");

        // None of the three reached the store.
        expect((await caller().getAll({ projectId: PROJECT })) as unknown[]).toEqual([]);
      });
    });
  });

  describe("given the mounted router", () => {
    it("declares one analytics permission per procedure, reads apart from writes", () => {
      expect(declarationsOf(router())).toEqual({
        getAll: { kind: "permission", permission: "analytics:view" },
        getById: { kind: "permission", permission: "analytics:view" },
        create: { kind: "permission", permission: "analytics:create" },
        update: { kind: "permission", permission: "analytics:update" },
        run: { kind: "permission", permission: "analytics:view" },
        delete: { kind: "permission", permission: "analytics:delete" },
      });
    });

    it("stores every chart under the workbench kind", async () => {
      const saved = await saveChart();

      const row = await database().customGraph.findUnique({ where: { id: saved.id } });
      expect(row?.kind).toBe(WORKBENCH_SQL_CHART_KIND);
    });
  });
});

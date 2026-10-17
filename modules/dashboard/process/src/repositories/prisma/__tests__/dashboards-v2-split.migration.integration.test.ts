/**
 * The `dashboards_v2_tables` migration over one board of each class: what it copies, with ids,
 * and that it changes no legacy row, then nothing on a second run. Spec: dashboards-v2.feature.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:dashboard:dashboards-v2-split-migration-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for the Dashboards v2 split migration tests");
  }

  return connection.client;
}

const MIGRATION_SQL = readFileSync(
  join(
    import.meta.dirname,
    "../../../../../../../packages/prisma-client/prisma/migrations",
    "20261015120000_dashboards_v2_tables/migration.sql",
  ),
  "utf8",
);

/**
 * Each statement, its copies scoped to the test's projects so a shared database's other rows
 * stay put. Every copy's WHERE is one parenthesised condition, so the appended AND bounds it all.
 */
const statementsScopedTo = (projectIds: readonly string[]): string[] =>
  MIGRATION_SQL.replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) =>
      statement.replace(
        /\nON CONFLICT/,
        `\nAND "projectId" IN (${projectIds.map((id) => `'${id}'`).join(", ")})\nON CONFLICT`,
      ),
    );

async function runMigration(projectIds: readonly string[]): Promise<void> {
  for (const statement of statementsScopedTo(projectIds)) {
    await database().$executeRawUnsafe(statement);
  }
}

describe.skipIf(!databaseUrl)("the Dashboards v2 split migration", () => {
  const organizationId = `test-org-${randomUUID()}`;
  const teamId = `test-team-${randomUUID()}`;
  /** Has used Dashboards: it holds widgets. */
  const activeProjectId = `test-project-${randomUUID()}`;
  /** Has never used Dashboards: no widget and no star anywhere in it. */
  const quietProjectId = `test-project-${randomUUID()}`;
  const projectIds = [activeProjectId, quietProjectId];
  const memberId = `test-user-${randomUUID()}`;
  const boards = {
    widgetsOnly: randomUUID(),
    builderOnly: randomUUID(),
    workbenchOnly: randomUUID(),
    mixed: randomUUID(),
    reportsStarred: randomUUID(),
    emptyStarred: randomUUID(),
    emptyOnlyMe: randomUUID(),
    emptyDescribed: randomUUID(),
    emptyOrganization: randomUUID(),
    emptyAuthoredActive: randomUUID(),
    emptyAuthoredQuiet: randomUUID(),
    emptyPlain: randomUUID(),
  };
  const graphs = {
    widgetOnWidgetsOnly: randomUUID(),
    builderOnBuilderOnly: randomUUID(),
    workbenchOnWorkbenchOnly: randomUUID(),
    widgetOnMixed: randomUUID(),
    workbenchOnMixed: randomUUID(),
    builderOnReportsStarred: randomUUID(),
    unplacedWidget: randomUUID(),
  };
  const createdAt = new Date("2026-10-01T10:00:00.000Z");
  const updatedAt = new Date("2026-10-02T11:00:00.000Z");

  const legacyRows = async () => ({
    dashboards: await database().dashboard.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { id: "asc" },
    }),
    graphs: await database().customGraph.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { id: "asc" },
    }),
  });
  const copiedRows = async () => ({
    boards: await database().dashboardsV2.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { id: "asc" },
    }),
    widgets: await database().dashboardWidget.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { id: "asc" },
    }),
  });

  let legacyBefore: Awaited<ReturnType<typeof legacyRows>>;

  beforeAll(async () => {
    await database().organization.create({
      data: { id: organizationId, name: "Split org", slug: `split-org-${randomUUID()}` },
    });
    await database().team.create({
      data: { id: teamId, name: "Split team", slug: `split-team-${randomUUID()}`, organizationId },
    });
    await database().project.createMany({
      data: projectIds.map((id) => ({
        id,
        name: "Split project",
        slug: `split-project-${randomUUID()}`,
        apiKey: `split-key-${randomUUID()}`,
        teamId,
        language: "other",
        framework: "other",
      })),
    });
    const board = ({
      id,
      projectId = activeProjectId,
      ...rest
    }: {
      id: string;
      projectId?: string;
      description?: string;
      createdById?: string;
      scope?: "PRIVATE" | "PROJECT" | "ORGANIZATION";
      organizationId?: string;
    }) => ({ id, projectId, name: `board ${id}`, createdAt, updatedAt, ...rest });
    await database().dashboard.createMany({
      data: [
        board({ id: boards.widgetsOnly, createdById: memberId }),
        board({ id: boards.builderOnly, createdById: memberId }),
        board({ id: boards.workbenchOnly }),
        board({ id: boards.mixed, createdById: memberId }),
        board({ id: boards.reportsStarred }),
        board({ id: boards.emptyStarred }),
        board({ id: boards.emptyOnlyMe, createdById: memberId, scope: "PRIVATE" }),
        board({ id: boards.emptyDescribed, projectId: quietProjectId, description: "Spend" }),
        board({
          id: boards.emptyOrganization,
          projectId: quietProjectId,
          scope: "ORGANIZATION",
          organizationId,
        }),
        board({ id: boards.emptyAuthoredActive, createdById: memberId }),
        board({ id: boards.emptyAuthoredQuiet, projectId: quietProjectId, createdById: memberId }),
        board({ id: boards.emptyPlain }),
      ],
    });
    const graph = ({
      id,
      kind,
      dashboardId,
    }: {
      id: string;
      kind: "builder" | "workbench_sql" | "dashboard_srcdoc";
      dashboardId: string | null;
    }) => ({
      id,
      projectId: activeProjectId,
      dashboardId,
      name: `graph ${id}`,
      kind,
      graph: { kind, id },
      gridColumn: 2,
      gridRow: 3,
      colSpan: 4,
      rowSpan: 5,
      createdAt,
      updatedAt,
    });
    await database().customGraph.createMany({
      data: [
        graph({
          id: graphs.widgetOnWidgetsOnly,
          kind: "dashboard_srcdoc",
          dashboardId: boards.widgetsOnly,
        }),
        graph({
          id: graphs.builderOnBuilderOnly,
          kind: "builder",
          dashboardId: boards.builderOnly,
        }),
        graph({
          id: graphs.workbenchOnWorkbenchOnly,
          kind: "workbench_sql",
          dashboardId: boards.workbenchOnly,
        }),
        graph({ id: graphs.widgetOnMixed, kind: "dashboard_srcdoc", dashboardId: boards.mixed }),
        graph({ id: graphs.workbenchOnMixed, kind: "workbench_sql", dashboardId: boards.mixed }),
        graph({
          id: graphs.builderOnReportsStarred,
          kind: "builder",
          dashboardId: boards.reportsStarred,
        }),
        graph({ id: graphs.unplacedWidget, kind: "dashboard_srcdoc", dashboardId: null }),
      ],
    });
    await database().dashboardFavourite.createMany({
      data: [boards.reportsStarred, boards.emptyStarred].map((dashboardId, position) => ({
        userId: memberId,
        dashboardId,
        projectId: activeProjectId,
        position,
      })),
    });
    legacyBefore = await legacyRows();

    await runMigration(projectIds);
  });

  afterAll(async () => {
    await database().dashboardWidget.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().dashboardsV2.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().dashboardFavourite.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().customGraph.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().dashboard.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().project.deleteMany({ where: { id: { in: projectIds } } });
    await database().team.deleteMany({ where: { id: teamId, organizationId } });
    await database().organization.deleteMany({ where: { id: organizationId } });
    await connection?.closeOnce();
  });

  describe("given one board of each class, a star and an unplaced widget", () => {
    describe("when the migration runs", () => {
      /** @scenario "AC199e Split: each existing board lands in Dashboards, Reports or both by what it holds" */
      it("copies into DashboardsV2 exactly the boards with a widget, a Dashboards sign or the author case", async () => {
        const { boards: copied } = await copiedRows();

        expect(copied.map((row) => row.id).toSorted()).toEqual(
          [
            boards.widgetsOnly,
            boards.mixed,
            boards.reportsStarred,
            boards.emptyStarred,
            boards.emptyOnlyMe,
            boards.emptyDescribed,
            boards.emptyOrganization,
            boards.emptyAuthoredActive,
          ].toSorted(),
        );
      });

      /** @scenario "AC199e Split: each existing board lands in Dashboards, Reports or both by what it holds" */
      it("copies every widget, placed or not, into DashboardWidget and no chart made in Reports", async () => {
        const { widgets } = await copiedRows();

        expect(widgets.map((row) => row.id).toSorted()).toEqual(
          [graphs.widgetOnWidgetsOnly, graphs.widgetOnMixed, graphs.unplacedWidget].toSorted(),
        );
        expect(widgets.find((row) => row.id === graphs.unplacedWidget)?.dashboardId).toBeNull();
      });

      /** @scenario "AC199e Split: each existing board lands in Dashboards, Reports or both by what it holds" */
      it("changes no Dashboard or CustomGraph row, so Reports keeps every board it had", async () => {
        expect(await legacyRows()).toEqual(legacyBefore);
      });

      /** @scenario "AC199f Split: a copied board and widget keep their ids" */
      it("keeps each board's id and fields, so a star still names its board", async () => {
        const { boards: copied } = await copiedRows();
        const source = legacyBefore.dashboards.find((row) => row.id === boards.widgetsOnly);
        const stars = await database().dashboardFavourite.findMany({
          where: { projectId: activeProjectId, userId: memberId },
        });

        expect(copied.find((row) => row.id === boards.widgetsOnly)).toEqual({
          id: source?.id,
          projectId: source?.projectId,
          name: source?.name,
          description: source?.description,
          createdById: source?.createdById,
          scope: source?.scope,
          organizationId: source?.organizationId,
          createdAt: source?.createdAt,
          updatedAt: source?.updatedAt,
        });
        expect(stars).toHaveLength(2);
        expect(copied.map((row) => row.id)).toEqual(
          expect.arrayContaining(stars.map((star) => star.dashboardId)),
        );
      });

      /** @scenario "AC199f Split: a copied board and widget keep their ids" */
      it("keeps each widget's id, board, placement and definition", async () => {
        const { widgets } = await copiedRows();
        const source = legacyBefore.graphs.find((row) => row.id === graphs.widgetOnMixed);

        expect(widgets.find((row) => row.id === graphs.widgetOnMixed)).toEqual({
          id: source?.id,
          projectId: source?.projectId,
          dashboardId: boards.mixed,
          name: source?.name,
          definition: source?.graph,
          gridColumn: source?.gridColumn,
          gridRow: source?.gridRow,
          colSpan: source?.colSpan,
          rowSpan: source?.rowSpan,
          createdAt: source?.createdAt,
          updatedAt: source?.updatedAt,
        });
      });
    });

    describe("when it runs a second time after a copy was edited", () => {
      /** @scenario "AC199e Split: each existing board lands in Dashboards, Reports or both by what it holds" */
      it("changes nothing: an existing copy is kept as it is and no row is added", async () => {
        await database().dashboardsV2.update({
          where: { id: boards.mixed },
          data: { name: "Renamed in Dashboards" },
        });
        const before = await copiedRows();

        await runMigration(projectIds);

        expect(await copiedRows()).toEqual(before);
        expect(await legacyRows()).toEqual(legacyBefore);
      });
    });
  });
});

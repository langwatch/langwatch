/**
 * Dashboard widget service against real Postgres: grid rows allocate from
 * the placement target alone, cross-project `dashboardId` writes are
 * refused pre-persist (an IDOR the schema doesn't enforce).
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */
import { randomUUID } from "node:crypto";

import { DASHBOARD_SRCDOC_CHART_KIND } from "@langwatch/analytics-contract";
import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type {
  Dashboard,
  Organization,
  PrismaClient,
  Project,
  Team,
} from "@langwatch/prisma-client/generated";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaDashboardWidgetRepository } from "../../repositories/prisma/prisma.dashboard-widget.repository.ts";
import { DashboardWidgetService } from "../dashboard-widget.service.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:analytics:dashboard-widget-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for dashboard widget service tests");
  }
  return connection.client;
}

const QUERIES: DashboardWidgetQuery[] = [
  { name: "traces", sql: "SELECT count() AS value FROM analytics.traces" },
];
const OTHER_QUERIES: DashboardWidgetQuery[] = [
  { name: "errors", sql: "SELECT count() AS value FROM analytics.errors" },
];

describe.skipIf(!databaseUrl)("dashboard widget service (integration)", () => {
  let service: DashboardWidgetService;
  let organization: Organization;
  let team: Team;
  let project: Project;
  let otherProject: Project;

  const createProject = async () => {
    const slug = randomUUID();
    return database().project.create({
      data: {
        name: `Test Project ${slug}`,
        slug,
        apiKey: `test-api-key-${randomUUID()}`,
        teamId: team.id,
        language: "en",
        framework: "langchain",
        personalFeatures: {},
      },
    });
  };

  const createDashboard = async (ownerProject: Project): Promise<Dashboard> =>
    database().dashboard.create({
      data: {
        id: randomUUID(),
        name: "Test dashboard",
        projectId: ownerProject.id,
        order: 0,
      },
    });

  const create = (
    overrides: {
      dashboardId?: string;
      code?: string;
      queries?: DashboardWidgetQuery[];
    } = {},
  ) =>
    service.createWidget({
      projectId: project.id,
      dashboardId: overrides.dashboardId,
      input: {
        name: "Widget",
        code: overrides.code ?? "export default () => null;",
        queries: overrides.queries ?? QUERIES,
      },
    });

  beforeAll(async () => {
    service = DashboardWidgetService.create(
      PrismaDashboardWidgetRepository.create({ prisma: database() }),
    );
    organization = await database().organization.create({
      data: { name: "Test Org", slug: `test-org-${randomUUID()}` },
    });
    team = await database().team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${randomUUID()}`,
        organizationId: organization.id,
      },
    });
    project = await createProject();
    otherProject = await createProject();
  });

  afterEach(async () => {
    await database().customGraph.deleteMany({
      where: { projectId: { in: [project.id, otherProject.id] } },
    });
    await database().dashboard.deleteMany({
      where: { projectId: { in: [project.id, otherProject.id] } },
    });
  });

  afterAll(async () => {
    try {
      for (const { id } of [project, otherProject]) {
        await database().project.delete({ where: { id } });
      }
      await database().team.delete({ where: { id: team.id } });
      await database().organization.delete({ where: { id: organization.id } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given another dashboard already carries a tall card", () => {
    describe("when a widget is created on an empty target dashboard", () => {
      /** @scenario "A widget's grid row is allocated from its target dashboard alone" */
      it("allocates its row from the target dashboard alone, not the whole project", async () => {
        const dashboardA = await createDashboard(project);
        const dashboardB = await createDashboard(project);
        await database().customGraph.create({
          data: {
            id: randomUUID(),
            projectId: project.id,
            dashboardId: dashboardA.id,
            name: "Tall card on A",
            graph: { series: [] },
            gridRow: 0,
            rowSpan: 5,
          },
        });

        const widget = await create({ dashboardId: dashboardB.id });

        expect(widget.dashboardId).toBe(dashboardB.id);
        expect(widget.gridRow).toBe(0);
      });
    });

    describe("when a second widget is created on the same dashboard", () => {
      it("stacks below the first widget on that dashboard", async () => {
        const dashboard = await createDashboard(project);
        const first = await create({ dashboardId: dashboard.id });
        const second = await create({ dashboardId: dashboard.id });

        expect(second.gridRow).toBe(first.gridRow + first.rowSpan);
      });
    });
  });

  describe("given a dashboard that belongs to another project", () => {
    describe("when a widget is created targeting it", () => {
      /** @scenario "A widget targeting a dashboard from another project is refused" */
      it("refuses without persisting, indistinguishable from not found", async () => {
        const foreign = await createDashboard(otherProject);

        await expect(create({ dashboardId: foreign.id })).rejects.toMatchObject({
          code: "dashboard_widget_not_found",
        });

        const written = await database().customGraph.count({
          where: { projectId: project.id, kind: DASHBOARD_SRCDOC_CHART_KIND },
        });
        expect(written).toBe(0);
      });
    });

    describe("when an existing widget is assigned to it", () => {
      /** @scenario "A widget targeting a dashboard from another project is refused" */
      it("refuses and leaves the widget unplaced", async () => {
        const foreign = await createDashboard(otherProject);
        const widget = await create();

        await expect(
          service.assignToDashboard({
            id: widget.id,
            projectId: project.id,
            dashboardId: foreign.id,
          }),
        ).rejects.toMatchObject({ code: "dashboard_widget_not_found" });

        const read = await service.getById({
          id: widget.id,
          projectId: project.id,
        });
        expect(read.dashboardId).toBeNull();
      });
    });
  });

  describe("given a saved widget with both code and queries", () => {
    describe("when only the code is updated", () => {
      /** @scenario "A partial widget definition update keeps the untouched half" */
      it("keeps the stored queries", async () => {
        const widget = await create({ code: "old", queries: QUERIES });

        const updated = await service.updateWidget({
          id: widget.id,
          projectId: project.id,
          input: { code: "new" },
        });

        expect(updated.definition.code).toBe("new");
        expect(updated.definition.queries).toEqual(QUERIES);
      });
    });

    describe("when only the queries are updated", () => {
      /** @scenario "A partial widget definition update keeps the untouched half" */
      it("keeps the stored code", async () => {
        const widget = await create({ code: "keep", queries: QUERIES });

        const updated = await service.updateWidget({
          id: widget.id,
          projectId: project.id,
          input: { queries: OTHER_QUERIES },
        });

        expect(updated.definition.code).toBe("keep");
        expect(updated.definition.queries).toEqual(OTHER_QUERIES);
      });
    });
  });
});

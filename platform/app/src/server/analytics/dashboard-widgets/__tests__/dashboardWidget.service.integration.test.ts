/**
 * Dashboard widget service against a real Postgres.
 *
 * The claims that only a real database can make: that a widget's grid row is
 * allocated from the placement target alone (not every widget in the project),
 * that a `dashboardId` from another project is refused before it is persisted
 * (the IDOR the schema does not enforce), and that a partial definition update
 * keeps the half the caller did not send.
 *
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */

import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type {
  Dashboard,
  Organization,
  Project,
  Team,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";

import { DASHBOARD_SRCDOC_CHART_KIND } from "../../chartKinds";
import type { DashboardWidgetQuery } from "../../dashboardWidgetDefinition";
import { DashboardWidgetService } from "../dashboardWidget.service";

const QUERIES: DashboardWidgetQuery[] = [
  { name: "traces", sql: "SELECT count() AS value FROM analytics.traces" },
];
const OTHER_QUERIES: DashboardWidgetQuery[] = [
  { name: "errors", sql: "SELECT count() AS value FROM analytics.errors" },
];

describe("dashboard widget service (integration)", () => {
  let service: DashboardWidgetService;
  let organization: Organization;
  let team: Team;
  let project: Project;
  let otherProject: Project;

  const createProject = async () =>
    await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

  const createDashboard = async (ownerProject: Project): Promise<Dashboard> =>
    await prisma.dashboard.create({
      data: {
        id: nanoid(),
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
    service = DashboardWidgetService.create(prisma);
    organization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await createProject();
    otherProject = await createProject();
  });

  afterEach(async () => {
    await prisma.customGraph.deleteMany({
      where: { projectId: { in: [project.id, otherProject.id] } },
    });
    await prisma.dashboard.deleteMany({
      where: { projectId: { in: [project.id, otherProject.id] } },
    });
  });

  afterAll(async () => {
    for (const { id } of [project, otherProject]) {
      await prisma.project.delete({ where: { id } });
    }
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  describe("given another dashboard already carries a tall card", () => {
    describe("when a widget is created on an empty target dashboard", () => {
      /** @scenario "A widget's grid row is allocated from its target dashboard alone" */
      it("allocates its row from the target dashboard alone, not the whole project", async () => {
        const dashboardA = await createDashboard(project);
        const dashboardB = await createDashboard(project);
        await prisma.customGraph.create({
          data: {
            id: nanoid(),
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

        await expect(create({ dashboardId: foreign.id })).rejects.toMatchObject(
          { code: "dashboard_widget_not_found" },
        );

        const written = await prisma.customGraph.count({
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

/**
 * Custom chart widgets are cards on the dashboard grid, so this feature stores
 * them. Exercises the app's widget operations through its private service.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "./dashboard.fixture.ts";

describe("DashboardApp dashboard widgets", () => {
  it("forwards create, read, update, list, and delete through its widget service", async () => {
    const dashboard = createDashboardTestApp();
    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Usage",
      code: "export default () => null;",
      queries: [{ name: "usage", sql: "SELECT 1" }],
    });

    const updated = await dashboard.updateDashboardWidget({
      projectId: "project-1",
      id: created.id,
      code: "export default () => <div />;",
    });

    await expect(
      dashboard.getDashboardWidget({ projectId: "project-1", id: created.id }),
    ).resolves.toMatchObject({
      id: created.id,
      definition: {
        code: "export default () => <div />;",
        queries: [{ name: "usage", sql: "SELECT 1" }],
      },
    });
    await expect(dashboard.listDashboardWidgets({ projectId: "project-1" })).resolves.toEqual([
      updated,
    ]);

    await expect(
      dashboard.assignDashboardWidgetToDashboard({
        projectId: "project-1",
        id: created.id,
        dashboardId: "dashboard-1",
      }),
    ).resolves.toMatchObject({ dashboardId: "dashboard-1" });

    await dashboard.deleteDashboardWidget({ projectId: "project-1", id: created.id });

    await expect(dashboard.listDashboardWidgets({ projectId: "project-1" })).resolves.toEqual([]);
  });

  it("mints widget ids under the house scheme", async () => {
    const dashboard = createDashboardTestApp();

    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Usage",
      code: "export default () => null;",
      queries: [],
    });

    expect(created.id).toMatch(/(?:^|_)widget_[A-Za-z0-9]{29}$/);
  });
});

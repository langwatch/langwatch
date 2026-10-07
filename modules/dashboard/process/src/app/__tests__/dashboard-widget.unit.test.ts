/**
 * Custom chart widgets are cards on the dashboard grid, so this feature stores
 * them. Exercises the app's widget operations through its private service.
 * @vitest-environment node
 */
import { dashboardWidgetDefinitionSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestApp,
  createDashboardTestRepositoriesWithBoard,
} from "./dashboard.fixture.ts";

describe("DashboardModule dashboard widgets", () => {
  it("forwards create, read, update, list, and delete through its widget service", async () => {
    const repositories = await createDashboardTestRepositoriesWithBoard();
    const dashboard = createDashboardTestApp({ repositories });
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

  /** @scenario "AC123 Ask Langy: the prompt is stored on built widgets and kept on edit and duplicate" */
  it("stores a widget's Langy prompt and keeps it when its code is edited", async () => {
    const dashboard = createDashboardTestApp();
    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Usage",
      code: "export default () => null;",
      queries: [],
      prompt: "How much traffic did my agent get?",
    });

    await dashboard.updateDashboardWidget({
      projectId: "project-1",
      id: created.id,
      code: "export default () => <div />;",
      queries: [],
    });

    expect(created.definition.prompt).toBe("How much traffic did my agent get?");
    await expect(
      dashboard.getDashboardWidget({ projectId: "project-1", id: created.id }),
    ).resolves.toMatchObject({
      definition: {
        code: "export default () => <div />;",
        prompt: "How much traffic did my agent get?",
      },
    });
  });

  /** @scenario "AC113 Widget description: the description is stored and kept when the code is edited" */
  it("stores a widget's description and keeps it when its code is edited", async () => {
    const dashboard = createDashboardTestApp();
    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Usage",
      code: "export default () => null;",
      queries: [],
      description: "Traces per bucket",
    });

    await dashboard.updateDashboardWidget({
      projectId: "project-1",
      id: created.id,
      code: "export default () => <div />;",
      queries: [],
    });

    expect(created.definition.description).toBe("Traces per bucket");
    await expect(
      dashboard.getDashboardWidget({ projectId: "project-1", id: created.id }),
    ).resolves.toMatchObject({
      definition: { code: "export default () => <div />;", description: "Traces per bucket" },
    });
  });

  /** @scenario "A widget created with a source stores that source" */
  it("stores the source a widget is created with", async () => {
    const dashboard = createDashboardTestApp();

    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Errors per day",
      code: "export default () => null;",
      queries: [],
      source: { kind: "catalogue", catalogueId: "errors-per-day" },
    });

    expect(created.definition.source).toEqual({
      kind: "catalogue",
      catalogueId: "errors-per-day",
    });
  });

  /** @scenario "An update keeps the stored source unless it names one" */
  it("keeps the stored source on an update without one, and replaces it with one", async () => {
    const dashboard = createDashboardTestApp();
    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Errors per day",
      code: "export default () => null;",
      queries: [],
      source: { kind: "catalogue", catalogueId: "errors-per-day" },
    });

    const kept = await dashboard.updateDashboardWidget({
      projectId: "project-1",
      id: created.id,
      code: "export default () => <div />;",
    });
    const replaced = await dashboard.updateDashboardWidget({
      projectId: "project-1",
      id: created.id,
      source: { kind: "code" },
    });

    expect(kept.definition.source).toEqual({ kind: "catalogue", catalogueId: "errors-per-day" });
    expect(replaced.definition).toMatchObject({
      code: "export default () => <div />;",
      source: { kind: "code" },
    });
  });

  /** @scenario "A widget saved before sources existed still reads" */
  it("reads a definition stored with no source", async () => {
    const dashboard = createDashboardTestApp();
    const created = await dashboard.createDashboardWidget({
      projectId: "project-1",
      name: "Usage",
      code: "export default () => null;",
      queries: [],
    });

    const stored = dashboardWidgetDefinitionSchema.safeParse({
      version: 1,
      code: "export default () => null;",
      queries: [{ name: "usage", sql: "SELECT 1" }],
    });

    expect(stored.success).toBe(true);
    await expect(
      dashboard.getDashboardWidget({ projectId: "project-1", id: created.id }),
    ).resolves.not.toHaveProperty("definition.source");
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

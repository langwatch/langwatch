/**
 * The widget service parses a definition before it writes, so a row its own read would
 * refuse never reaches the repository.
 * @see modules/dashboard/specs/dashboard-widget-validation.feature
 */
import { describe, expect, it } from "vitest";

import { createDashboardTestAnalytics } from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardWidgetRepository } from "../../repositories/memory/memory.dashboard-widget.repository.ts";
import { DashboardWidgetService } from "../dashboard-widget.service.ts";

const CODE = "export default function Widget() { return null; }";
const QUERY = { name: "traces", sql: "SELECT count() AS value FROM analytics.traces" };
const VALID = [QUERY];
const INVALID = [{ ...QUERY, parameters: [{ name: "prototype", type: "string" as const }] }];

function setUp() {
  const repository = MemoryDashboardWidgetRepository.create();
  const service = DashboardWidgetService.create({
    repository,
    analytics: createDashboardTestAnalytics(),
  });
  return { repository, service };
}

describe("given the dashboard widget service over the memory repository", () => {
  /** @scenario "The widget service refuses an invalid definition before writing it" */
  describe("when a definition with a prototype parameter name is written", () => {
    it("refuses the create and stores nothing", async () => {
      const { repository, service } = setUp();

      await expect(
        service.createWidget({
          projectId: "project-1",
          input: { name: "Traces", code: CODE, queries: INVALID },
        }),
      ).rejects.toMatchObject({ code: "dashboard_widget_definition_refused", httpStatus: 422 });
      expect(await repository.findAll({ projectId: "project-1" })).toEqual([]);
    });

    it("refuses the update and keeps the stored definition", async () => {
      const { service } = setUp();
      const created = await service.createWidget({
        projectId: "project-1",
        input: { name: "Traces", code: CODE, queries: VALID },
      });

      await expect(
        service.updateWidget({
          projectId: "project-1",
          id: created.id,
          input: { queries: INVALID },
        }),
      ).rejects.toMatchObject({ code: "dashboard_widget_definition_refused", httpStatus: 422 });
      const read = await service.getById({ projectId: "project-1", id: created.id });
      expect(read.definition.queries).toEqual(VALID);
    });
  });
});

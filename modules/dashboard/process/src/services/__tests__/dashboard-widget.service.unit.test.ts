/**
 * The widget service parses a definition before it writes, so a row its own read would
 * refuse never reaches the repository.
 * @see modules/dashboard/specs/dashboard-widget-validation.feature
 */
import { LangWatchQLProjectNotFoundError } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestAuthz,
  createDashboardTestProjects,
  DASHBOARDS_ROLLED_OUT,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryBoardRepository } from "../../repositories/memory/memory.board.repository.ts";
import { MemoryDashboardWidgetRepository } from "../../repositories/memory/memory.dashboard-widget.repository.ts";
import { DashboardAccessService } from "../dashboard-access.service.ts";
import { DashboardWidgetService } from "../dashboard-widget.service.ts";

const CODE = "export default function Widget() { return null; }";
const QUERY = { name: "traces", sql: "SELECT count() AS value FROM analytics.traces" };
const VALID = [QUERY];
const INVALID = [{ ...QUERY, parameters: [{ name: "prototype", type: "string" as const }] }];

function setUp(analytics = createDashboardTestAnalytics()) {
  const repository = MemoryDashboardWidgetRepository.create();
  const service = DashboardWidgetService.create({
    repository,
    analytics,
    boards: DashboardAccessService.create({
      repository: MemoryBoardRepository.create(),
      projects: createDashboardTestProjects(),
      rollout: DASHBOARDS_ROLLED_OUT,
      authz: createDashboardTestAuthz(),
    }),
  });
  return { repository, service };
}

describe("given the dashboard widget service over the memory repository", () => {
  describe("when a definition with a prototype parameter name is written", () => {
    /** @scenario "The widget service refuses an invalid definition before writing it" */
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

    /** @scenario "The widget service refuses an invalid definition before writing it" */
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
      expect(read.definition.queries).toEqual([{ ...QUERY, sources: ["application"] }]);
    });
  });
});

describe("given a query's sources", () => {
  const scope = { projectId: "project-1" };

  /** A widget saved before queries carried sources: stored straight, as the old build wrote it. */
  async function unsetWidget(repository: MemoryDashboardWidgetRepository) {
    return repository.createWidget({
      ...scope,
      id: "w-unset",
      input: { name: "Old", code: CODE, queries: [QUERY] },
    });
  }

  describe("when a widget is created with queries naming none", () => {
    /** @scenario "AC200o Sources: a new widget's query counts application traces" */
    it("stores application on each, and keeps a picked set as sent", async () => {
      const { service } = setUp();

      const created = await service.createWidget({
        ...scope,
        input: {
          name: "Traces",
          code: CODE,
          queries: [QUERY, { ...QUERY, name: "turns", sources: ["langy"] }],
        },
      });

      expect(created.definition.queries.map((query) => query.sources)).toEqual([
        ["application"],
        ["langy"],
      ]);
    });
  });

  describe("when a widget that stores none is read, or saved with another field changed", () => {
    /** @scenario "AC200f Sources: a query that stores none counts application traces" */
    it("is not rewritten: its queries still store no sources", async () => {
      const { repository, service } = setUp();
      const widget = await unsetWidget(repository);

      const read = await service.getById({ ...scope, id: widget.id });
      await service.updateWidget({ ...scope, id: widget.id, input: { name: "Renamed" } });
      await service.updateWidget({
        ...scope,
        id: widget.id,
        input: { code: CODE, queries: [QUERY] },
      });
      const after = await service.getById({ ...scope, id: widget.id });

      expect(read.definition.queries).toEqual([QUERY]);
      expect(after.definition.queries).toEqual([QUERY]);
    });
  });

  describe("when an update sends a query without sources, or with null", () => {
    /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
    it("keeps the sources stored under its name, and null clears them", async () => {
      const { service } = setUp();
      const created = await service.createWidget({
        ...scope,
        input: { name: "Traces", code: CODE, queries: [{ ...QUERY, sources: ["langy"] }] },
      });

      const kept = await service.updateWidget({
        ...scope,
        id: created.id,
        input: { queries: [{ ...QUERY, sql: "SELECT 1" }] },
      });
      const cleared = await service.updateWidget({
        ...scope,
        id: created.id,
        input: { queries: [{ ...QUERY, sources: null }] },
      });

      expect(kept.definition.queries[0]?.sources).toEqual(["langy"]);
      expect(cleared.definition.queries[0]).not.toHaveProperty("sources");
    });
  });
});

describe("given a query's projects", () => {
  const scope = { projectId: "project-1" };
  const readsOnly = (readable: string[]) =>
    createDashboardTestAnalytics({
      assertProjectsReadable: async ({ projectIds }) => {
        if (projectIds.some((id) => !readable.includes(id))) {
          throw new LangWatchQLProjectNotFoundError();
        }
      },
    });

  /** @scenario "AC210b Compatibility: the dashboard API, the CLI and the MCP tools read and write projects beside sources" */
  it("stores the projects a member can read, and reads them back in order", async () => {
    const { service } = setUp(readsOnly(["A", "B"]));

    const created = await service.createWidget({
      ...scope,
      viewer: { userId: "user-1" },
      input: { name: "Traces", code: CODE, queries: [{ ...QUERY, projects: ["B", "A"] }] },
    });

    expect(created.definition.queries[0]?.projects).toEqual(["B", "A"]);
  });

  /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
  it("refuses a project the writer cannot read, with no id and nothing stored", async () => {
    const { repository, service } = setUp(readsOnly(["A"]));

    const refusal = await service
      .createWidget({
        ...scope,
        viewer: { userId: "user-1" },
        input: { name: "Traces", code: CODE, queries: [{ ...QUERY, projects: ["A", "C"] }] },
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({ code: "project_not_found", httpStatus: 404 });
    expect(JSON.stringify(refusal, ["message", "meta"])).not.toContain('"C"');
    expect(await repository.findAll(scope)).toEqual([]);
  });

  /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
  it("lets a project credential name its own project and no other", async () => {
    const { service } = setUp();

    const own = await service.createWidget({
      ...scope,
      input: { name: "Own", code: CODE, queries: [{ ...QUERY, projects: ["project-1"] }] },
    });
    const other = service
      .createWidget({
        ...scope,
        input: { name: "Other", code: CODE, queries: [{ ...QUERY, projects: ["project-2"] }] },
      })
      .catch((error: unknown) => error);

    expect(own.definition.queries[0]?.projects).toEqual(["project-1"]);
    await expect(other).resolves.toMatchObject({ code: "project_not_found" });
  });

  /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
  it("judges a key's write by the key's reach, not by its owner's grants", async () => {
    const asked: unknown[] = [];
    const analytics = createDashboardTestAnalytics({
      assertProjectsReadable: async (input) => {
        asked.push(input);
        if (input.reach !== undefined && input.projectIds.includes("secret")) {
          throw new LangWatchQLProjectNotFoundError();
        }
      },
    });
    const { repository, service } = setUp(analytics);
    const keyReach = {
      kind: "apiKey",
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
    } as const;

    const refusal = await service
      .createWidget({
        ...scope,
        viewer: { userId: "user-1" },
        keyReach,
        input: { name: "Traces", code: CODE, queries: [{ ...QUERY, projects: ["secret"] }] },
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({ code: "project_not_found", httpStatus: 404 });
    expect(asked).toEqual([
      { reach: keyReach, projectIds: ["secret"], anchorProjectId: scope.projectId },
    ]);
    expect(await repository.findAll(scope)).toEqual([]);
  });

  /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
  it("judges the projects an update keeps, not only those it sends", async () => {
    const asked: string[][] = [];
    let isRefusing = false;
    const analytics = createDashboardTestAnalytics({
      assertProjectsReadable: async ({ projectIds }) => {
        if (!isRefusing) return;
        asked.push([...projectIds]);
        if (projectIds.includes("P2")) throw new LangWatchQLProjectNotFoundError();
      },
    });
    const { service } = setUp(analytics);
    const row = await service.createWidget({
      ...scope,
      viewer: { userId: "user-1" },
      input: { name: "Stored", code: CODE, queries: [{ ...QUERY, projects: ["P1", "P2"] }] },
    });
    isRefusing = true;

    const refusal = await service
      .updateWidget({
        ...scope,
        id: row.id,
        viewer: { userId: "user-1" },
        input: { queries: [{ ...QUERY, sql: "SELECT 1" }] },
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({ code: "project_not_found", httpStatus: 404 });
    expect(asked).toEqual([["P1", "P2"]]);
  });

  /** @scenario "AC207c Project: a query stores at most as many projects as a member's list may hold" */
  it("holds the cap per query: two queries of 60 distinct projects are each within it", async () => {
    const asked: number[] = [];
    const analytics = createDashboardTestAnalytics({
      assertProjectsReadable: async ({ projectIds }) => void asked.push(projectIds.length),
    });
    const { service } = setUp(analytics);
    const sixty = (prefix: string) => Array.from({ length: 60 }, (_, index) => `${prefix}${index}`);

    await service.createWidget({
      ...scope,
      viewer: { userId: "user-1" },
      input: {
        name: "Two",
        code: CODE,
        queries: [
          { ...QUERY, name: "one", projects: sixty("a") },
          { ...QUERY, name: "two", projects: sixty("b") },
        ],
      },
    });

    expect(asked).toEqual([60, 60]);
  });

  /** @scenario "AC207c Project: a query stores at most as many projects as a member's list may hold" */
  it("refuses more projects than a member's list may hold", async () => {
    const { service } = setUp();
    const tooMany = Array.from({ length: 101 }, (_, index) => `p${index}`);

    await expect(
      service.createWidget({
        ...scope,
        input: { name: "Many", code: CODE, queries: [{ ...QUERY, projects: tooMany }] },
      }),
    ).rejects.toMatchObject({
      code: "dashboard_widget_definition_refused",
      httpStatus: 422,
      message: "This dashboard widget's definition is invalid.",
    });
  });
});

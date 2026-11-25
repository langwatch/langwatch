/**
 * ADR-177 decision 8 on the dashboard module: an aggregate's reports and trace list seed nothing
 * on read, and every saved-view write is refused as read only. Main's aggregate-project-writes.
 * @see specs/governance/aggregate-project.feature
 */
import { PROJECT_KIND, type Project, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { createDashboardTestApp } from "./dashboard.fixture.ts";

const AGGREGATE = "project-aggregate";
const MEMBER = "project-member";
const at = new Date("2026-01-01T00:00:00.000Z");

function project({ id, kind }: { id: string; kind: Project["kind"] }): Project {
  return {
    id,
    name: id,
    slug: id,
    apiKey: "",
    lwqlKey: "",
    teamId: "team-1",
    language: "other",
    framework: "other",
    kind,
    firstMessage: false,
    integrated: false,
    createdAt: at,
    updatedAt: at,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    aggregateRule: kind === PROJECT_KIND.AGGREGATE ? { kind: "all-personal" } : null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function setup() {
  const repositories = MemoryDashboardRepositories.create();
  const projects = createApiFixture<ProjectApi>({
    findById: async (id) =>
      project({
        id,
        kind: id === AGGREGATE ? PROJECT_KIND.AGGREGATE : PROJECT_KIND.APPLICATION,
      }),
    findSummaryById: async () => ({ name: "Project", slug: "project" }),
  });
  const app = createDashboardTestApp({ repositories, dependencies: { projects } });
  return { app, repositories };
}

const actorId = "user-ana";

describe("given an aggregate project and one of its members", () => {
  describe("when ana opens the aggregate's reports and trace list for the first time", () => {
    /** @scenario "Opening an aggregate page never writes a default row under it" */
    it("returns no dashboard and no views, and writes no row", async () => {
      const { app, repositories } = setup();

      await expect(app.getOrCreateFirst({ projectId: AGGREGATE })).resolves.toEqual([]);
      await expect(app.listSavedViews({ projectId: AGGREGATE, actorId })).resolves.toEqual([]);
      await expect(
        repositories.dashboards.findAllDashboards({ projectId: AGGREGATE, graphKinds: [] }),
      ).resolves.toEqual([]);
      await expect(repositories.savedViews.count({ projectId: AGGREGATE })).resolves.toBe(0);
    });
  });

  describe("when ana opens the member the same way", () => {
    /** @scenario "Opening an aggregate page never writes a default row under it" */
    it("still creates its first dashboard and default views", async () => {
      const { app } = setup();

      const [dashboard] = await app.getOrCreateFirst({ projectId: MEMBER });
      const views = await app.listSavedViews({ projectId: MEMBER, actorId });

      expect(dashboard?.projectId).toBe(MEMBER);
      expect(views.length).toBeGreaterThan(0);
    });
  });

  describe("when ana saves, renames, reorders or deletes a view on the aggregate", () => {
    const writes = {
      create: (app: ReturnType<typeof setup>["app"]) =>
        app.createSavedView({
          projectId: AGGREGATE,
          actorId,
          name: "Lens",
          filters: {},
          personal: false,
          kind: "v2-traces-lens",
        }),
      rename: (app: ReturnType<typeof setup>["app"]) =>
        app.renameSavedView({ projectId: AGGREGATE, actorId, viewId: "view-1", name: "Renamed" }),
      reorder: (app: ReturnType<typeof setup>["app"]) =>
        app.reorderSavedViews({ projectId: AGGREGATE, actorId, viewIds: ["view-1"] }),
      delete: (app: ReturnType<typeof setup>["app"]) =>
        app.deleteSavedView({ projectId: AGGREGATE, actorId, viewId: "view-1" }),
    };

    /** @scenario "Saving, renaming, reordering or deleting a view is refused on the aggregate" */
    it.each(Object.entries(writes))(
      "refuses %s as read only and writes no saved view row",
      async (_name, write) => {
        const { app, repositories } = setup();

        await expect(write(app)).rejects.toMatchObject({ code: "aggregate_project_is_read_only" });
        await expect(repositories.savedViews.count({ projectId: AGGREGATE })).resolves.toBe(0);
      },
    );
  });

  describe("when ana saves a view on the member", () => {
    /** @scenario "Saving, renaming, reordering or deleting a view is refused on the aggregate" */
    it("writes the view", async () => {
      const { app } = setup();

      const view = await app.createSavedView({
        projectId: MEMBER,
        actorId,
        name: "Lens",
        filters: {},
        personal: false,
        kind: "v2-traces-lens",
      });

      expect(view.projectId).toBe(MEMBER);
    });
  });
});

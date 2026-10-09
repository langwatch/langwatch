/**
 * Saved-view writes are declared under `traces:view`, which the permission-level guard reads as
 * a read, so each asks the project itself whether it takes writes (ADR-175 decision 8). The
 * seeding reads ask too, and write nothing under an aggregate.
 * @vitest-environment node
 */
import { AggregateProjectIsReadOnlyError } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import type { DashboardModule } from "../dashboard.app.ts";
import { createDashboardTestApp, createDashboardTestProjects } from "./dashboard.fixture.ts";

const PROJECT = "project-1";
const ACTOR = "user-1";

function appOver(repositories: DashboardRepositories, { aggregate }: { aggregate: boolean }) {
  const projects = aggregate
    ? createDashboardTestProjects("aggregate", {
        acceptsWrites: async () => false,
        assertAcceptsWrites: async () => {
          throw new AggregateProjectIsReadOnlyError();
        },
      })
    : createDashboardTestProjects();

  return createDashboardTestApp({ repositories, dependencies: { projects } });
}

async function withOneView() {
  const repositories = MemoryDashboardRepositories.create();
  await repositories.savedViews.create({
    id: "view-1",
    projectId: PROJECT,
    name: "Mine",
    filters: {},
    order: 0,
  });
  return repositories;
}

const writes: [string, (app: DashboardModule) => Promise<unknown>][] = [
  [
    "createSavedView",
    (app) =>
      app.createSavedView({
        projectId: PROJECT,
        actorId: ACTOR,
        name: "New",
        filters: {},
        personal: false,
      }),
  ],
  [
    "deleteSavedView",
    (app) => app.deleteSavedView({ projectId: PROJECT, actorId: ACTOR, viewId: "view-1" }),
  ],
  [
    "renameSavedView",
    (app) =>
      app.renameSavedView({
        projectId: PROJECT,
        actorId: ACTOR,
        viewId: "view-1",
        name: "Renamed",
      }),
  ],
  [
    "reorderSavedViews",
    (app) => app.reorderSavedViews({ projectId: PROJECT, actorId: ACTOR, viewIds: ["view-1"] }),
  ],
];

describe("DashboardModule saved-view writes", () => {
  describe.each(writes)("when %s is called", (_name, act) => {
    describe("given an aggregate project", () => {
      it("refuses as read-only and leaves the views untouched", async () => {
        const repositories = await withOneView();
        const before = await repositories.savedViews.findAll({ projectId: PROJECT });

        await expect(act(appOver(repositories, { aggregate: true }))).rejects.toMatchObject({
          code: "aggregate_project_is_read_only",
        });
        await expect(repositories.savedViews.findAll({ projectId: PROJECT })).resolves.toEqual(
          before,
        );
      });
    });

    describe("given an ordinary project", () => {
      it("writes", async () => {
        const repositories = await withOneView();
        const before = await repositories.savedViews.findAll({ projectId: PROJECT });

        await act(appOver(repositories, { aggregate: false }));

        await expect(repositories.savedViews.findAll({ projectId: PROJECT })).resolves.not.toEqual(
          before,
        );
      });
    });
  });
});

describe("DashboardModule.listSavedViews", () => {
  describe("given an aggregate project with no views", () => {
    it("seeds nothing", async () => {
      const repositories = MemoryDashboardRepositories.create();

      await expect(
        appOver(repositories, { aggregate: true }).listSavedViews({
          projectId: PROJECT,
          actorId: ACTOR,
        }),
      ).resolves.toEqual([]);
      await expect(repositories.savedViews.count({ projectId: PROJECT })).resolves.toBe(0);
    });
  });

  describe("given an ordinary project with no views", () => {
    it("seeds the default views", async () => {
      const repositories = MemoryDashboardRepositories.create();

      const views = await appOver(repositories, { aggregate: false }).listSavedViews({
        projectId: PROJECT,
        actorId: ACTOR,
      });

      expect(views.length).toBeGreaterThan(0);
    });
  });
});

describe("DashboardModule.getOrCreateFirst", () => {
  describe("given an aggregate project with no dashboard", () => {
    it("refuses as read-only and creates nothing", async () => {
      const repositories = MemoryDashboardRepositories.create();
      const app = appOver(repositories, { aggregate: true });

      await expect(app.getOrCreateFirst({ projectId: PROJECT })).rejects.toMatchObject({
        code: "aggregate_project_is_read_only",
      });
      await expect(app.getAll({ projectId: PROJECT, graphCountScope: "builder" })).resolves.toEqual(
        [],
      );
    });
  });

  describe("given an ordinary project with no dashboard", () => {
    it("creates the first one", async () => {
      const app = appOver(MemoryDashboardRepositories.create(), { aggregate: false });

      await expect(app.getOrCreateFirst({ projectId: PROJECT })).resolves.toMatchObject({
        projectId: PROJECT,
        order: 0,
      });
    });
  });
});

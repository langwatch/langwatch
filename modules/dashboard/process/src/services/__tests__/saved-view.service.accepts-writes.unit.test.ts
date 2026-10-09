/**
 * The seed on read is the only write SavedViewService.getAll makes, so the caller must say
 * whether the project takes writes. An aggregate (ADR-175) takes none; a required flag means
 * a forgotten one fails to compile instead of seeding default views under the aggregate.
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import { MemorySavedViewRepository } from "../../repositories/memory/memory.saved-view.repository.ts";
import type { DashboardService } from "../dashboard.service.ts";
import { SavedViewService } from "../saved-view.service.ts";

function buildService() {
  const repository = MemorySavedViewRepository.create();

  return { repository, service: SavedViewService.create({ repository }) };
}

describe("SavedViewService.getAll()", () => {
  describe("given a caller that does not say whether the project takes writes", () => {
    describe("when it reads the views", () => {
      /** @scenario "A read that seeds defaults must be told whether the project takes writes" */
      it("does not compile", () => {
        const { service } = buildService();

        // @ts-expect-error acceptsWrites is required, so omitting it is a type error.
        const read = () => service.getAll({ projectId: "proj-1" });

        expect(read).toBeTypeOf("function");
      });
    });

    describe("when it reads the first dashboard instead", () => {
      /** @scenario "A read that seeds defaults must be told whether the project takes writes" */
      it("does not compile either, matching DashboardService", () => {
        type FirstDashboardArgs = Parameters<DashboardService["getOrCreateFirst"]>[0];
        // @ts-expect-error acceptsWrites is required on the dashboard seed too.
        const withoutFlag: FirstDashboardArgs = { projectId: "proj-1" };

        expect(withoutFlag.projectId).toBe("proj-1");
      });
    });
  });

  describe("given a project that takes no writes", () => {
    describe("when its views are read", () => {
      /** @scenario "A read that seeds defaults must be told whether the project takes writes" */
      it("returns what exists and seeds nothing", async () => {
        const { service, repository } = buildService();
        await repository.create({
          id: "view-1",
          projectId: "agg-1",
          name: "Mine",
          filters: {},
          order: 0,
        });

        const views = await service.getAll({ projectId: "agg-1", acceptsWrites: false });

        expect(views.map((view) => view.name)).toEqual(["Mine"]);
        await expect(repository.count({ projectId: "agg-1" })).resolves.toBe(1);
      });
    });
  });

  describe("given a project that takes writes and has no views", () => {
    describe("when its views are read", () => {
      it("seeds the default views", async () => {
        const { service, repository } = buildService();

        await service.getAll({ projectId: "proj-1", acceptsWrites: true });

        await expect(repository.count({ projectId: "proj-1" })).resolves.toBeGreaterThan(0);
      });
    });
  });
});

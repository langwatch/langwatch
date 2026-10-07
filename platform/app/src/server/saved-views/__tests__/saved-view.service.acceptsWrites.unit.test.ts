/**
 * The seed on read is the only write SavedViewService.getAll makes, so the
 * caller must say whether the project takes writes. An aggregate (ADR-144)
 * takes none. Making the flag required means a forgotten flag fails to
 * compile instead of seeding default views under the aggregate.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { DashboardService } from "~/server/dashboards/dashboard.service";
import type { SavedViewRepository } from "../saved-view.repository";
import { SavedViewService } from "../saved-view.service";

function buildService({ existing }: { existing: number }) {
  const repository = {
    count: vi.fn().mockResolvedValue(existing),
    findAll: vi.fn().mockResolvedValue([]),
    findByIds: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
  };
  const service = new SavedViewService(
    repository as unknown as SavedViewRepository,
  );
  return { service, repository };
}

describe("SavedViewService.getAll()", () => {
  /** @scenario "A read that seeds defaults must be told whether the project takes writes" */
  it("requires the caller to say whether the project takes writes", async () => {
    const { service } = buildService({ existing: 0 });

    // @ts-expect-error acceptsWrites is required, so omitting it is a type error.
    await service.getAll({ projectId: "proj-1" });
  });

  /** @scenario "A read that seeds defaults must be told whether the project takes writes" */
  it("matches DashboardService, whose seeding read requires it too", () => {
    type FirstDashboardArgs = Parameters<
      DashboardService["getOrCreateFirst"]
    >[0];
    // @ts-expect-error acceptsWrites is required on the dashboard seed too.
    const withoutFlag: FirstDashboardArgs = { projectId: "proj-1" };

    expect(withoutFlag.projectId).toBe("proj-1");
  });

  describe("when the project takes no writes", () => {
    /** @scenario "A read that seeds defaults must be told whether the project takes writes" */
    it("returns what exists and seeds nothing", async () => {
      const { service, repository } = buildService({ existing: 0 });

      await service.getAll({ projectId: "agg-1", acceptsWrites: false });

      expect(repository.count).not.toHaveBeenCalled();
      expect(repository.createMany).not.toHaveBeenCalled();
      expect(repository.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "agg-1" }),
      );
    });
  });

  describe("when the project takes writes and has no views", () => {
    it("seeds the default views", async () => {
      const { service, repository } = buildService({ existing: 0 });

      await service.getAll({ projectId: "proj-1", acceptsWrites: true });

      expect(repository.createMany).toHaveBeenCalledTimes(1);
    });
  });
});

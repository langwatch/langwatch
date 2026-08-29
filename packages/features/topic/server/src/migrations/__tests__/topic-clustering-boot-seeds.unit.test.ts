import { describe, expect, it, vi } from "vitest";
import { LegacyImportTopicClusteringMigration } from "../legacy-import.topic-clustering.migration";
import type { TopicClusteringRepository } from "../../repositories/topic-clustering.repository";

/**
 * The boot-seed wiring's contract with composition: one synchronous call
 * fires both seeds in the background and never lets a failure escape to the
 * boot path. The seed walks themselves are tested in topic-model-seed /
 * topic-clustering-schedule-seed unit tests; here only the composition is
 * real.
 *
 * Both seeds page the GLOBAL `Project` model (the tenancy guard exempts it),
 * so they are told apart by the repository method each walk drives: the
 * topic-model seed pages the projects that own Topic rows, the schedule seed
 * pages eligible projects.
 */

function fakeRepository() {
  const repository = {
    tryFindProject: vi.fn(),
    findTopicIndexRows: vi.fn(),
    findModelTopics: vi.fn(),
    findModelSubtopics: vi.fn(),
    recordClusteringCost: vi.fn(),
    tryFindTopicModelCursor: vi.fn(),
    findSeedTopicRows: vi.fn(),
    findProjectsWithTopicsPage: vi.fn().mockResolvedValue([]),
    findEligibleProjectsPage: vi.fn().mockResolvedValue([]),
    findOwnedTopicModelProjectIds: vi.fn().mockResolvedValue([]),
    findAlreadyScheduledProjectIds: vi.fn().mockResolvedValue([]),
  };
  const _checked: TopicClusteringRepository = repository;
  return repository;
}

function makeCommands() {
  return {
    recordTopics: vi.fn().mockResolvedValue(undefined),
    requestClustering: vi.fn().mockResolvedValue(undefined),
  };
}

describe("startBootSeeds", () => {
  describe("when a worker boots", () => {
    it("fires both seed walks in the background", async () => {
      const repository = fakeRepository();
      const migration = LegacyImportTopicClusteringMigration.create({
        repository,
        redis: null,
        commands: makeCommands(),
      });

      migration.startBootSeeds();

      await vi.waitFor(() => {
        // Topic-model seed pages the projects that own Topic rows…
        expect(repository.findProjectsWithTopicsPage).toHaveBeenCalled();
        // …and the schedule seed pages eligible projects.
        expect(repository.findEligibleProjectsPage).toHaveBeenCalled();
      });
    });
  });

  describe("when every query rejects", () => {
    it("returns without throwing and surfaces nothing to the boot path", async () => {
      const repository = {
        ...fakeRepository(),
        findProjectsWithTopicsPage: vi.fn().mockRejectedValue(new Error("pg down")),
        findEligibleProjectsPage: vi.fn().mockRejectedValue(new Error("pg down")),
        findOwnedTopicModelProjectIds: vi.fn().mockRejectedValue(new Error("pg down")),
        findAlreadyScheduledProjectIds: vi.fn().mockRejectedValue(new Error("pg down")),
      };
      const migration = LegacyImportTopicClusteringMigration.create({
        repository,
        redis: null,
        commands: makeCommands(),
      });

      expect(() => migration.startBootSeeds()).not.toThrow();

      // Both seeds' page walk rejects; both rejections must be consumed
      // (no unhandled rejection escapes to the boot path).
      await vi.waitFor(() => {
        expect(repository.findProjectsWithTopicsPage).toHaveBeenCalled();
      });
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});

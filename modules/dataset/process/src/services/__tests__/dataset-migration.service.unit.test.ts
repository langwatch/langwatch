import { memoryObjectStorage } from "@langwatch/process-stores";
import { PROJECT_ID_PAGE_LIMIT, type ProjectIdPageInput } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import type { DatasetMigrationRepository } from "../../repositories/dataset-migration.repository.ts";
import { MemoryDatasetMigrationRepository } from "../../repositories/memory/memory.dataset-migration.repository.ts";
import { ObjectStorageDatasetChunkRepository } from "../../repositories/object-storage/object-storage.dataset-chunk.repository.ts";
import { DatasetMigrationService } from "../dataset-migration.service.ts";

const PAGES: Record<string, { ids: string[]; next: string | null }> = {
  start: { ids: ["project_a", "project_b"], next: "project_b" },
  project_b: { ids: ["project_c", "project_d"], next: "project_d" },
  project_d: { ids: ["project_e"], next: null },
};

function subject(
  listAllIds: (input?: ProjectIdPageInput) => Promise<{ ids: string[]; next: string | null }>,
) {
  const repository: DatasetMigrationRepository = MemoryDatasetMigrationRepository.create();
  const findPostgresDatasetIds = vi.spyOn(repository, "findPostgresDatasetIds");
  const projects = { listAllIds: vi.fn(listAllIds) };
  const migration = DatasetMigrationService.create({
    repository,
    storage: ObjectStorageDatasetChunkRepository.create({ objectStorage: memoryObjectStorage() }),
    projects,
  });
  return { findPostgresDatasetIds, migration, projects };
}

describe("DatasetMigrationService project scan", () => {
  describe("given an install whose project ids span three pages", () => {
    /** @scenario "The content migration visits every project across id pages" */
    it("reads each page after the previous cursor and scans every project once", async () => {
      const { findPostgresDatasetIds, migration, projects } = subject(
        async (input) => PAGES[input?.after ?? "start"] ?? { ids: [], next: null },
      );

      await expect(migration.run()).resolves.toMatchObject({ status: "completed" });

      expect(projects.listAllIds.mock.calls.map(([input]) => input)).toEqual([
        { after: undefined, limit: PROJECT_ID_PAGE_LIMIT },
        { after: "project_b", limit: PROJECT_ID_PAGE_LIMIT },
        { after: "project_d", limit: PROJECT_ID_PAGE_LIMIT },
      ]);
      expect(findPostgresDatasetIds.mock.calls.map(([input]) => input.projectId)).toEqual([
        "project_a",
        "project_b",
        "project_c",
        "project_d",
        "project_e",
      ]);
    });
  });

  describe("given the project module refuses to read the project ids", () => {
    /** @scenario "A failed project-id read fails the content migration run" */
    it("fails the run with that error instead of a completed summary", async () => {
      const refusal = new Error("project read unavailable");
      const { findPostgresDatasetIds, migration } = subject(async () => {
        throw refusal;
      });

      await expect(migration.run()).rejects.toBe(refusal);
      expect(findPostgresDatasetIds).not.toHaveBeenCalled();
    });
  });
});

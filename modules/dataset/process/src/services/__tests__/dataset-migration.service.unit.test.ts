import { memoryObjectStorage } from "@langwatch/process-stores";
import { PROJECT_ID_PAGE_LIMIT, type ProjectIdPageInput } from "@langwatch/project-contract";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { describe, expect, it, vi } from "vitest";

import type {
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
} from "../../repositories/dataset-migration.repository.ts";
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

/** One postgres-layout dataset per project, each holding one record. */
function step(
  input: {
    abortAfterProject?: string;
    /** This project's first commit throws, as a row the move cannot write. */
    failOnceProject?: string;
    /** This project's first commit finds its records changed meanwhile. */
    changedOnceProject?: string;
  } = {},
) {
  const controller = new AbortController();
  const attempted = new Set<string>();
  const commit = vi.fn(
    async ({ projectId }: { projectId: string }): Promise<DatasetMigrationOutcome> => {
      if (projectId === input.abortAfterProject) controller.abort();
      const first = !attempted.has(projectId);
      attempted.add(projectId);
      if (first && projectId === input.failOnceProject) throw new Error("row unreadable");
      if (first && projectId === input.changedOnceProject) return "skipped-concurrent-write";
      return "migrated";
    },
  );
  const repository: DatasetMigrationRepository = {
    findPostgresDatasetIds: async ({ projectId, afterId }) =>
      afterId ? [] : [`dataset_of_${projectId}`],
    isPostgresLayout: async () => true,
    getFingerprint: async () => ({ count: 1, maxUpdatedAt: null }),
    findRecordPage: async ({ afterId }) => (afterId ? [] : [{ id: "record_1", entry: { a: 1 } }]),
    commit,
    isSchemaPending: () => false,
  };
  const objectStorage = memoryObjectStorage();
  const write = vi.spyOn(objectStorage, "write");
  const migration = DatasetMigrationService.create({
    repository,
    storage: ObjectStorageDatasetChunkRepository.create({ objectStorage }),
    projects: {
      listAllIds: async (page) => PAGES[page?.after ?? "start"] ?? { ids: [], next: null },
    },
  });
  const saved: string[] = [];
  const onProjectDone = async ({ afterProjectId }: { afterProjectId: string }) => {
    saved.push(afterProjectId);
  };
  const reports: MigrationStepReport[] = [];
  const checkpoint = (resumeFrom: MigrationStepReport | null) => ({
    resumeFrom,
    save: async ({ report }: { report: MigrationStepReport }) => {
      reports.push(report);
    },
  });
  return {
    migration,
    commit,
    write,
    saved,
    onProjectDone,
    signal: controller.signal,
    reports,
    checkpoint,
  };
}

describe("DatasetMigrationService as an upgrade step", () => {
  describe("given a checkpoint saved after project_b", () => {
    /** @scenario "The content move resumes after the last project it finished" */
    it("moves only the datasets of the projects after it", async () => {
      const { migration, commit, saved, onProjectDone } = step();

      await migration.run({ afterProjectId: "project_b", onProjectDone });

      expect(commit.mock.calls.map(([call]) => call.projectId)).toEqual([
        "project_c",
        "project_d",
        "project_e",
      ]);
      expect(saved).toEqual(["project_c", "project_d", "project_e"]);
    });
  });

  describe("given the run is aborted while moving project_c", () => {
    /** @scenario "An aborted content move keeps the last finished project as its cursor" */
    it("stops there without reporting project_c finished", async () => {
      const { migration, commit, saved, onProjectDone, signal } = step({
        abortAfterProject: "project_c",
      });

      await migration.run({ signal, onProjectDone });

      expect(commit).toHaveBeenCalledTimes(3);
      expect(saved).toEqual(["project_a", "project_b"]);
    });
  });

  describe("given a dry run", () => {
    /** @scenario "A dry run of the content move writes nothing" */
    it("counts what would move and writes no chunk and commits no dataset", async () => {
      const { migration, commit, write } = step();

      await expect(migration.run({ dryRun: true })).resolves.toMatchObject({
        status: "completed",
        summary: { wouldMigrate: 5, migrated: 0 },
      });
      expect(write).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    });
  });

  describe("given a dataset in project_c fails to move", () => {
    /** @scenario "A dataset that fails to move keeps the content move unfinished" */
    it("rejects the step and never checkpoints past project_b", async () => {
      const { migration, reports, checkpoint } = step({ failOnceProject: "project_c" });

      await expect(
        migration.runStep({
          checkpoint: checkpoint(null),
          dryRun: false,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("1 datasets failed");
      expect(reports).toEqual([{ afterProjectId: "project_a" }, { afterProjectId: "project_b" }]);
    });

    /** @scenario "A retry of an unfinished content move completes it" */
    it("completes on the retry from the saved checkpoint", async () => {
      const { migration, commit, reports, checkpoint } = step({ failOnceProject: "project_c" });
      const signal = new AbortController().signal;
      await expect(
        migration.runStep({ checkpoint: checkpoint(null), dryRun: false, signal }),
      ).rejects.toThrow("1 datasets failed");
      commit.mockClear();

      await expect(
        migration.runStep({
          checkpoint: checkpoint(reports.at(-1) ?? null),
          dryRun: false,
          signal,
        }),
      ).resolves.toMatchObject({ failed: 0, skippedConcurrentWrite: 0 });
      expect(commit.mock.calls.map(([call]) => call.projectId)).toEqual([
        "project_c",
        "project_d",
        "project_e",
      ]);
      expect(reports.at(-1)).toEqual({ afterProjectId: "project_e" });
    });
  });

  describe("given a dataset in project_c changed while it moved", () => {
    /** @scenario "A dataset skipped for a concurrent write keeps the content move unfinished" */
    it("reports the run incomplete and never checkpoints past project_b", async () => {
      const { migration, saved, onProjectDone } = step({ changedOnceProject: "project_c" });

      await expect(migration.run({ onProjectDone })).resolves.toMatchObject({
        status: "incomplete",
        summary: { skippedConcurrentWrite: 1 },
      });
      expect(saved).toEqual(["project_a", "project_b"]);
    });
  });
});

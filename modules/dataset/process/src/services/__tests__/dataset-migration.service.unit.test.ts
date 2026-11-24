import { datasetRecordSchema } from "@langwatch/dataset-contract";
import { memoryObjectStorage } from "@langwatch/process-stores";
import { PROJECT_ID_PAGE_LIMIT, type ProjectIdPageInput } from "@langwatch/project-contract";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { describe, expect, it, vi } from "vitest";

import type {
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
} from "../../repositories/dataset-migration.repository.ts";
import { MemoryDatasetMigrationRepository } from "../../repositories/memory/memory.dataset-migration.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
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
  const repository: DatasetMigrationRepository = MemoryDatasetMigrationRepository.create({
    database: MemoryDatasetDatabase.create(),
  });
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
    findMoveNotes: async () => ({ archived: false, rowsUnderOtherProject: 0 }),
    getFingerprint: async () => ({ count: 1, maxUpdatedAt: null, digest: "" }),
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
  /** The cursor each progress save names: the last project finished. */
  const onProgress = async ({ afterProjectId }: { afterProjectId: string | undefined }) => {
    saved.push(afterProjectId ?? "none");
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
    onProgress,
    signal: controller.signal,
    reports,
    checkpoint,
  };
}

describe("DatasetMigrationService as an upgrade step", () => {
  describe("given a checkpoint saved after project_b", () => {
    /** @scenario "The content move resumes after the last project it finished" */
    it("moves only the datasets of the projects after it", async () => {
      const { migration, commit, saved, onProgress } = step();

      await migration.run({ afterProjectId: "project_b", onProgress });

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
      const { migration, commit, saved, onProgress, signal } = step({
        abortAfterProject: "project_c",
      });

      await migration.run({ signal, onProgress });

      expect(commit).toHaveBeenCalledTimes(3);
      expect(saved).toEqual(["project_a", "project_b", "project_b"]);
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
          log: { info: () => undefined, warn: () => undefined },
          checkpoint: checkpoint(null),
          dryRun: false,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("1 datasets failed");
      expect(reports.map((report) => report.afterProjectId)).toEqual([
        "project_a",
        "project_b",
        "project_b",
        "project_b",
        "project_b",
      ]);
    });

    /** @scenario "A retry of an unfinished content move completes it" */
    it("completes on the retry from the saved checkpoint", async () => {
      const { migration, commit, reports, checkpoint } = step({ failOnceProject: "project_c" });
      const signal = new AbortController().signal;
      await expect(
        migration.runStep({
          log: { info: () => undefined, warn: () => undefined },
          checkpoint: checkpoint(null),
          dryRun: false,
          signal,
        }),
      ).rejects.toThrow("1 datasets failed");
      commit.mockClear();

      await expect(
        migration.runStep({
          log: { info: () => undefined, warn: () => undefined },
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
      expect(reports.at(-1)).toMatchObject({ afterProjectId: "project_e" });
    });
  });

  describe("given a dataset in project_c changed while it moved", () => {
    /** @scenario "A dataset skipped for a concurrent write keeps the content move unfinished" */
    it("reports the run incomplete and never checkpoints past project_b", async () => {
      const { migration, saved, onProgress } = step({ changedOnceProject: "project_c" });

      await expect(migration.run({ onProgress })).resolves.toMatchObject({
        status: "incomplete",
        summary: { skippedConcurrentWrite: 1 },
      });
      expect(saved).toEqual(["project_a", "project_b", "project_b", "project_b", "project_b"]);
    });
  });
});

/** Two postgres-layout datasets per project; one commit, or one later page read, fails once. */
function memoryStep({
  failCommitOf = "dataset_project_b_2",
  failNextPageOf,
}: { failCommitOf?: string; failNextPageOf?: string } = {}) {
  const database = MemoryDatasetDatabase.create();
  const repository = MemoryDatasetMigrationRepository.create({ database });
  const now = new Date(Date.UTC(2026, 0, 1));
  for (const projectId of ["project_a", "project_b", "project_c"]) {
    for (const n of [1, 2]) {
      const id = `dataset_${projectId}_${n}`;
      database.putDataset({
        id,
        projectId,
        name: id,
        slug: id,
        columnTypes: [{ name: "question", type: "string" }],
        mapping: null,
        useS3: false,
        s3RecordCount: null,
        contentLayout: "postgres",
        status: "ready",
        statusError: null,
        stagingKey: null,
        uploadFilename: null,
        sourceStoredObjectId: null,
        rowCount: null,
        sizeBytes: null,
        chunkCount: null,
        chunkOffsets: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      database.putRecord(
        datasetRecordSchema.parse({
          id: `record_${id}`,
          datasetId: id,
          projectId,
          entry: { question: id },
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }
  const commit = repository.commit.bind(repository);
  let failedOnce = false;
  vi.spyOn(repository, "commit").mockImplementation(async (input) => {
    if (input.datasetId === failCommitOf && !failedOnce) {
      failedOnce = true;
      throw new Error("row unreadable");
    }
    return commit(input);
  });
  const findIds = repository.findPostgresDatasetIds.bind(repository);
  const pageFailure = new Error("page read failed");
  let pageFailedOnce = false;
  vi.spyOn(repository, "findPostgresDatasetIds").mockImplementation(async (input) => {
    if (input.projectId === failNextPageOf && input.afterId && !pageFailedOnce) {
      pageFailedOnce = true;
      throw pageFailure;
    }
    return findIds(input);
  });
  const migration = DatasetMigrationService.create({
    repository,
    storage: ObjectStorageDatasetChunkRepository.create({ objectStorage: memoryObjectStorage() }),
    projects: {
      listAllIds: async (page) => ({
        ids: ["project_a", "project_b", "project_c"].filter(
          (id) => !page?.after || id > page.after,
        ),
        next: null,
      }),
    },
  });
  /** The ledger row's report: what the last attempt saved is what the next one resumes from. */
  const ledger: { report: MigrationStepReport | null } = { report: null };
  const attempt = () =>
    migration.runStep({
      log: { info: () => undefined, warn: () => undefined },
      checkpoint: {
        resumeFrom: ledger.report,
        save: async ({ report }) => {
          ledger.report = report;
        },
      },
      dryRun: false,
      signal: new AbortController().signal,
    });
  return { migration, ledger, attempt, pageFailure };
}

describe("DatasetMigrationService report across attempts", () => {
  describe("given a dataset in project_b fails on the first attempt", () => {
    /** @scenario "A move that retried reports every dataset it moved across its attempts" */
    it("reports all six datasets moved once the retry completes", async () => {
      const { ledger, attempt } = memoryStep();

      await expect(attempt()).rejects.toThrow("1 datasets failed");
      expect(ledger.report).toMatchObject({ afterProjectId: "project_a", migrated: 5 });

      await expect(attempt()).resolves.toMatchObject({
        migrated: 6,
        failed: 0,
        skippedConcurrentWrite: 0,
      });
    });
  });

  describe("given project_b's next page read fails after both its datasets moved", () => {
    /** @scenario "A move that retried reports every dataset it moved across its attempts" */
    it("saves the two moved datasets before the error, so the retry reports all six", async () => {
      const { ledger, attempt, pageFailure } = memoryStep({
        failCommitOf: "none",
        failNextPageOf: "project_b",
      });

      await expect(attempt()).rejects.toBe(pageFailure);
      expect(ledger.report).toMatchObject({ afterProjectId: "project_a", migrated: 4 });

      await expect(attempt()).resolves.toMatchObject({ migrated: 6, failed: 0 });
    });
  });

  describe("given a checkpoint an older release saved, holding only its cursor", () => {
    /** @scenario "A move that retried reports every dataset it moved across its attempts" */
    it("resumes after it and counts from zero", async () => {
      const { ledger, attempt } = memoryStep();
      ledger.report = { afterProjectId: "project_b" };

      await expect(attempt()).resolves.toMatchObject({ migrated: 2, failed: 0 });
    });
  });

  describe("given a checkpoint whose counts are malformed", () => {
    /** @scenario "A move that retried reports every dataset it moved across its attempts" */
    it("still resumes after its cursor and counts the malformed totals from zero", async () => {
      const { ledger, attempt } = memoryStep();
      ledger.report = { afterProjectId: "project_b", migrated: "many", archived: -3 };

      await expect(attempt()).resolves.toMatchObject({ migrated: 2, archived: 0 });
    });
  });
});

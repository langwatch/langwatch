import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatasetTestApp } from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { FilesystemDatasetSingleFileRepository } from "../../repositories/filesystem/filesystem.dataset-single-file.repository.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetSingleFileConversionService } from "../dataset-single-file-conversion.service.ts";

const projectId = "project_single";

/** The array the previous release wrote: `{ id, entry, ... }` per record, in order. */
const threeRecords = [
  { id: "r1", entry: { question: "one" }, datasetId: "", projectId, position: 1000 },
  { id: "r2", entry: { question: "two" }, datasetId: "", projectId, position: 2000 },
  { id: "r3", entry: { question: "three" }, datasetId: "", projectId, position: 3000 },
];

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dataset-single-file-conversion-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function install(storage: "object storage" | "local disk" = "object storage") {
  const repositories: DatasetRepositories =
    storage === "local disk"
      ? {
          ...MemoryDatasetRepositories.create(),
          singleFiles: FilesystemDatasetSingleFileRepository.create({ localPath: root }),
        }
      : MemoryDatasetRepositories.create();
  const projects = {
    pages: (_after: string | undefined): { ids: string[]; next: string | null } => ({
      ids: [projectId],
      next: null,
    }),
  };
  const conversion = DatasetSingleFileConversionService.create({
    conversion: repositories.singleFileConversion,
    datasets: repositories.content,
    files: repositories.singleFiles,
    chunks: repositories.chunks,
    projects: createApiFixture<ProjectApi>({
      listAllIds: async (input) => projects.pages(input?.after),
    }),
  });
  const app = createDatasetTestApp({ repositories });

  /** A single-file dataset as the previous release left it; `file: "none"` stores no file. */
  const singleFile = async (
    input: { file?: unknown[] | string | "none"; recordedCount?: number; inProject?: string } = {},
  ) => {
    const file = input.file ?? threeRecords;
    const owner = input.inProject ?? projectId;
    const dataset = await repositories.content.create({
      projectId: owner,
      name: `legacy-${Math.random()}`,
      slug: `legacy-${Math.random().toString(36).slice(2)}`,
      columnTypes: [{ name: "question", type: "string" }],
      contentLayout: "postgres",
      useS3: true,
      s3RecordCount: input.recordedCount ?? (Array.isArray(file) ? file.length : 0),
    });
    if (file !== "none") {
      await repositories.singleFiles.putSingleFile({
        projectId: owner,
        datasetId: dataset.id,
        text: typeof file === "string" ? file : JSON.stringify(file),
      });
    }
    return dataset.id;
  };
  const row = (datasetId: string, owner = projectId) =>
    repositories.content.getOne({ id: datasetId, projectId: owner });
  const read = async (datasetId: string) =>
    (await app.getDatasetWithRecords({ slugOrId: datasetId, projectId })).records;
  const oldFile = (datasetId: string) =>
    repositories.singleFiles.getSingleFile({ projectId, datasetId });
  return { repositories, projects, conversion, app, singleFile, row, read, oldFile };
}

function stepArgs(
  input: { dryRun?: boolean; resumeFrom?: MigrationStepReport | null } = {},
): Parameters<DatasetSingleFileConversionService["runStep"]>[0] & { saved: MigrationStepReport[] } {
  const saved: MigrationStepReport[] = [];
  return {
    saved,
    dryRun: input.dryRun ?? false,
    signal: new AbortController().signal,
    log: { info: () => undefined, warn: () => undefined },
    checkpoint: {
      resumeFrom: input.resumeFrom ?? null,
      save: async ({ report }) => void saved.push(report),
    },
  };
}

describe("the single-file conversion step", () => {
  describe("given a single-file dataset in object storage holding r1, r2 and r3", () => {
    /** @scenario "A single-file dataset in object storage is converted to chunks with the same rows" */
    it("reads them in order from chunks and is no longer a single-file dataset", async () => {
      const { conversion, singleFile, row, read } = install();
      const datasetId = await singleFile();

      await conversion.runStep(stepArgs());

      expect(await row(datasetId)).toMatchObject({
        contentLayout: "s3_jsonl",
        useS3: false,
        rowCount: 3,
      });
      expect((await read(datasetId)).map((record) => record.id)).toEqual(["r1", "r2", "r3"]);
    });
  });

  describe("given DATASET_STORAGE_LOCAL and a single-file dataset on local disk", () => {
    /** @scenario "A single-file dataset on local disk is converted too" */
    it("reads its records from chunks", async () => {
      const { conversion, singleFile, row, read } = install("local disk");
      const datasetId = await singleFile({ file: threeRecords.slice(0, 2) });

      await conversion.runStep(stepArgs());

      expect((await row(datasetId)).contentLayout).toBe("s3_jsonl");
      expect((await read(datasetId)).map((record) => record.entry)).toEqual([
        { question: "one" },
        { question: "two" },
      ]);
    });
  });

  describe("given a record stored without an id that was read once", () => {
    /** @scenario "A record stored without an id keeps the id it was already shown with" */
    it("keeps the id it was shown with", async () => {
      const { conversion, singleFile, read } = install();
      const datasetId = await singleFile({
        file: [{ entry: { question: "no id" }, datasetId: "", projectId }],
      });
      const [shown] = await read(datasetId);
      expect(shown?.id).toEqual(expect.any(String));

      await conversion.runStep(stepArgs());

      expect((await read(datasetId)).map((record) => record.id)).toEqual([shown?.id]);
    });
  });

  describe("given a recorded count of 10 over a file holding 8 records", () => {
    /** @scenario "The converted dataset counts the rows it actually holds" */
    it("counts 8 and names the dataset as having had a wrong count", async () => {
      const { conversion, singleFile, row } = install();
      const file = Array.from({ length: 8 }, (_, index) => ({
        id: `r${index}`,
        entry: { question: `q${index}` },
      }));
      const datasetId = await singleFile({ file, recordedCount: 10 });

      const report = await conversion.runStep(stepArgs());

      expect((await row(datasetId)).rowCount).toBe(8);
      expect(report).toMatchObject({ converted: 1, wrongRecordedCount: [datasetId] });
    });
  });

  describe("given a converted single-file dataset", () => {
    /** @scenario "The old single file is kept after conversion" */
    it("leaves the old file where it was and counts it as left for removal", async () => {
      const { conversion, singleFile, oldFile } = install();
      const datasetId = await singleFile();

      const report = await conversion.runStep(stepArgs());

      expect(await oldFile(datasetId)).toEqual({
        outcome: "found",
        text: JSON.stringify(threeRecords),
      });
      expect(report).toMatchObject({ oldFilesLeft: 1 });
    });
  });

  describe("given a single-file dataset whose recorded count is 21 and whose file is missing", () => {
    /** @scenario "A single-file dataset whose file is missing is not converted" */
    it("stays a single-file dataset, is named in the report, and the step is not done", async () => {
      const { conversion, singleFile, row } = install();
      const datasetId = await singleFile({ file: "none", recordedCount: 21 });

      await expect(conversion.run()).resolves.toMatchObject({
        status: "incomplete",
        report: { missingFile: [datasetId], converted: 0 },
      });
      await expect(conversion.runStep(stepArgs())).rejects.toThrow(datasetId);
      expect(await row(datasetId)).toMatchObject({ contentLayout: "postgres", useS3: true });
    });

    /** @scenario "A single-file dataset whose file is missing is not converted" */
    it("converts one recorded as empty, which the previous release never gave a file", async () => {
      const { conversion, singleFile, row, read } = install();
      const datasetId = await singleFile({ file: "none", recordedCount: 0 });

      await conversion.runStep(stepArgs());

      expect(await row(datasetId)).toMatchObject({ contentLayout: "s3_jsonl", rowCount: 0 });
      expect(await read(datasetId)).toEqual([]);
    });
  });

  describe("given a single-file dataset whose file is not a list of records", () => {
    /** @scenario "A single-file dataset whose file is not a list of records is not converted" */
    it("leaves the dataset and its file as they were and fails naming it", async () => {
      const { conversion, singleFile, row, oldFile } = install();
      const datasetId = await singleFile({ file: '{"not":"an array"}' });
      const args = stepArgs();

      await expect(conversion.runStep(args)).rejects.toThrow(datasetId);

      expect(await row(datasetId)).toMatchObject({ contentLayout: "postgres", useS3: true });
      expect(await oldFile(datasetId)).toEqual({ outcome: "found", text: '{"not":"an array"}' });
      expect(args.saved).toEqual([]);
    });
  });

  describe("given a row added while the dataset is being converted", () => {
    /** @scenario "A write to a single-file dataset waits while it is converted" */
    it("adds the row after the conversion, to the dataset's chunks", async () => {
      const { repositories, conversion, app, singleFile, read, oldFile } = install();
      const datasetId = await singleFile();
      const lock = repositories.content.withDatasetLock.bind(repositories.content);
      let converting = true;
      // The write already chose the single-file path; the conversion holds the lock first.
      vi.spyOn(repositories.content, "withDatasetLock").mockImplementation(async (id, mutate) => {
        if (converting) {
          converting = false;
          await conversion.runStep(stepArgs());
        }
        return lock(id, mutate);
      });

      await app.batchCreateRecords({
        slugOrId: datasetId,
        projectId,
        entries: [{ id: "r4", question: "four" }],
      });

      expect((await read(datasetId)).map((record) => record.id)).toEqual(["r1", "r2", "r3", "r4"]);
      expect(await oldFile(datasetId)).toEqual({
        outcome: "found",
        text: JSON.stringify(threeRecords),
      });
    });

    /** @scenario "A write to a single-file dataset waits while it is converted" */
    it("renames a column on the chunks too", async () => {
      const { repositories, conversion, app, singleFile, read, row } = install();
      const datasetId = await singleFile();
      const { name } = await row(datasetId);
      const lock = repositories.content.withDatasetLock.bind(repositories.content);
      let converting = true;
      vi.spyOn(repositories.content, "withDatasetLock").mockImplementation(async (id, mutate) => {
        if (converting) {
          converting = false;
          await conversion.runStep(stepArgs());
        }
        return lock(id, mutate);
      });

      await app.upsertDataset({
        projectId,
        datasetId,
        name,
        columnTypes: [{ name: "prompt", type: "string" }],
        columnRenames: [{ from: "question", to: "prompt" }],
      });

      expect((await read(datasetId)).map((record) => record.entry)).toEqual([
        { prompt: "one" },
        { prompt: "two" },
        { prompt: "three" },
      ]);
      expect((await row(datasetId)).columnTypes).toEqual([{ name: "prompt", type: "string" }]);
    });

    /** @scenario "A write to a single-file dataset waits while it is converted" */
    it("appends an uploaded file's rows to the chunks too", async () => {
      const { repositories, conversion, app, singleFile, read } = install();
      const datasetId = await singleFile();
      const lock = repositories.content.withDatasetLock.bind(repositories.content);
      let converting = true;
      vi.spyOn(repositories.content, "withDatasetLock").mockImplementation(async (id, mutate) => {
        if (converting) {
          converting = false;
          await conversion.runStep(stepArgs());
        }
        return lock(id, mutate);
      });
      const csv = "question\nuploaded\n";

      await app.uploadToExistingDataset({
        slugOrId: datasetId,
        projectId,
        filename: "more.csv",
        bytes: bytesOf(csv),
        fileSize: Buffer.byteLength(csv, "utf8"),
      });

      expect((await read(datasetId)).map((record) => record.entry)).toEqual([
        { question: "one" },
        { question: "two" },
        { question: "three" },
        { question: "uploaded" },
      ]);
    });
  });

  describe("given a checkpoint saved after a project", () => {
    /** @scenario "The conversion resumes after the last project it finished" */
    it("converts only the single-file datasets of the projects after it", async () => {
      const { conversion, projects, singleFile, row } = install();
      const before = await singleFile({ inProject: "project_a" });
      const after = await singleFile({ inProject: "project_b" });
      projects.pages = (after) =>
        after === "project_a"
          ? { ids: ["project_b"], next: null }
          : { ids: ["project_a", "project_b"], next: null };

      const args = stepArgs({ resumeFrom: { afterProjectId: "project_a" } });
      await conversion.runStep(args);

      expect((await row(before, "project_a")).contentLayout).toBe("postgres");
      expect((await row(after, "project_b")).contentLayout).toBe("s3_jsonl");
      expect(args.saved).toEqual([expect.objectContaining({ afterProjectId: "project_b" })]);
    });
  });

  describe("when the conversion runs as a dry run", () => {
    /** @scenario "A dry run of the conversion writes nothing" */
    it("counts the datasets and records it would convert and writes nothing", async () => {
      const { repositories, conversion, singleFile, row } = install();
      const first = await singleFile();
      await singleFile({ file: threeRecords.slice(0, 1) });
      const args = stepArgs({ dryRun: true });

      const report = await conversion.runStep(args);

      expect(report).toMatchObject({ dryRun: true, wouldConvert: 2, wouldConvertRecords: 4 });
      expect((await row(first)).contentLayout).toBe("postgres");
      await expect(
        repositories.chunks.readChunk({ projectId, datasetId: first, index: 0 }),
      ).rejects.toThrow();
      expect(args.saved).toEqual([]);
    });
  });

  describe("given a converted dataset", () => {
    it("finds nothing to do on a second run", async () => {
      const { conversion, singleFile } = install();
      await singleFile();
      await conversion.runStep(stepArgs());

      await expect(conversion.runStep(stepArgs())).resolves.toMatchObject({ converted: 0 });
    });
  });
});

async function* bytesOf(content: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(content);
}

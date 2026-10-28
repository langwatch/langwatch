/**
 * Dataset versions: snapshots saved by autosave, by hand, by experiment runs and
 * by restores; reads, comparisons and restores of them.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import {
  DatasetNotReadyError,
  DatasetVersionNotFoundError,
  DatasetVersionRestoreUnsupportedError,
  type CompareDatasetVersionInput,
  type Dataset,
  type DatasetColumns,
  type DatasetVersion,
  type DatasetVersionAuthor,
  type DatasetVersionComparison,
  type DatasetVersionPage,
  type DatasetVersionPageInput,
  type DatasetVersionRestored,
  type DatasetVersionRow,
  type DatasetVersionSavedEventData,
  type DatasetVersionTrigger,
} from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetRecordRepository } from "../repositories/dataset-record.repository.ts";
import type { DatasetVersionContentRepository } from "../repositories/dataset-version-content.repository.ts";
import {
  DatasetVersionNumberTakenError,
  type DatasetVersionRepository,
} from "../repositories/dataset-version.repository.ts";
import { isSingleFileDataset } from "../rules/dataset-single-file.rules.ts";
import {
  compareDatasetContents,
  DATASET_VERSION_ROWS_PER_CHUNK,
  versionChunksOfPage,
  versionRowOf,
  assertWithinWholeRead,
} from "../rules/dataset-version.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";
import { DatasetContentHasherService } from "./dataset-content-hasher.service.ts";

const logger = createLogger("langwatch:dataset:versions");

/** Rows read per page of a postgres-layout dataset while snapshotting it. */
const RECORD_PAGE_SIZE = 500;
/** Concurrent saves that each take the next number; past this the save gives up. */
const MAX_NUMBER_ATTEMPTS = 5;

export type DatasetVersionServiceDeps = {
  versions: DatasetVersionRepository;
  versionContent: DatasetVersionContentRepository;
  content: DatasetContentRepository;
  chunks: DatasetChunkRepository;
  records: DatasetRecordRepository;
  /** The dataset by slug or id; missing or archived refuses with `dataset_not_found`. */
  lookup: (input: { projectId: string; slugOrId: string }) => Promise<Dataset>;
  /** Every row of a legacy single-file dataset, read the way the dataset reads them. */
  readSingleFile: (dataset: Dataset) => Promise<DatasetVersionRow[]>;
  /** The most rows and bytes one whole read may hold, as the project's plan answers them. */
  wholeReadBounds: (projectId: string) => Promise<{ maxRows: number; maxBytes: number }>;
  generateId: () => string;
};

/** Where a saved version is announced, so the history refreshes; silent until connected. */
type VersionSavedSink = (data: DatasetVersionSavedEventData) => Promise<void>;

export type DatasetSnapshot = { version: DatasetVersion; created: boolean };

export class DatasetVersionService {
  #announce: VersionSavedSink = async () => undefined;

  private constructor(private readonly deps: DatasetVersionServiceDeps) {}

  static create(deps: DatasetVersionServiceDeps): DatasetVersionService {
    return new DatasetVersionService(deps);
  }

  connect(announce: VersionSavedSink): void {
    this.#announce = announce;
  }

  /**
   * Saves the dataset's current content as a new version, or answers the latest
   * one when the content hash is unchanged. A name on unchanged content names
   * the latest version instead.
   */
  async snapshot(input: {
    projectId: string;
    datasetId: string;
    trigger: DatasetVersionTrigger;
    by: DatasetVersionAuthor;
    name?: string;
    pinned?: boolean;
    restoredFromVersion?: number;
  }): Promise<DatasetSnapshot> {
    const dataset = await this.#readyDataset(input);
    const { contentHash } = await this.#hashCurrent(dataset);
    const latest = await this.deps.versions.findLatest({
      projectId: input.projectId,
      datasetId: dataset.id,
    });
    if (latest && latest.contentHash === contentHash) {
      return { version: await this.#keepUnchanged({ latest, input }), created: false };
    }
    return this.#writeVersion({ dataset, latest, input });
  }

  /** The versions, newest first, and whether the dataset's layout lets one be restored. */
  async history(input: {
    projectId: string;
    datasetId: string;
  }): Promise<{ versions: DatasetVersion[]; restorable: boolean }> {
    const dataset = await this.deps.lookup({
      projectId: input.projectId,
      slugOrId: input.datasetId,
    });
    const versions = await this.deps.versions.findAll({
      projectId: input.projectId,
      datasetId: dataset.id,
    });
    return { versions, restorable: !isSingleFileDataset(dataset) };
  }

  async get(input: {
    projectId: string;
    datasetId: string;
    version: number;
  }): Promise<DatasetVersion> {
    const dataset = await this.deps.lookup({
      projectId: input.projectId,
      slugOrId: input.datasetId,
    });
    const found = await this.deps.versions.findByNumber({
      projectId: input.projectId,
      datasetId: dataset.id,
      version: input.version,
    });
    if (!found) throw new DatasetVersionNotFoundError({ version: input.version });
    return found;
  }

  async page(input: DatasetVersionPageInput): Promise<DatasetVersionPage> {
    const version = await this.get(input);
    const page = input.page ?? 1;
    const limit = input.limit ?? 50;
    const { indexes, start, end } = versionChunksOfPage({
      page,
      limit,
      rowCount: version.rowCount,
    });
    const rows: DatasetVersionRow[] = [];
    for (const index of indexes) {
      const lines = await this.deps.versionContent.readChunk({ ...this.#address(version), index });
      lines.forEach((line, offset) => {
        const position = index * DATASET_VERSION_ROWS_PER_CHUNK + offset;
        if (position >= start && position < end) rows.push(versionRowOf(line, position));
      });
    }
    return { version, rows, pagination: { page, limit, total: version.rowCount } };
  }

  /** Every row of a version, refused before reading when it is larger than one whole read. */
  async readWhole(version: DatasetVersion): Promise<DatasetVersionRow[]> {
    await this.#assertWholeRead({
      projectId: version.projectId,
      rows: version.rowCount,
      bytes: version.sizeBytes,
    });
    return this.readRows(version);
  }

  /** Every row of a version, in the order it was saved. */
  async readRows(version: DatasetVersion): Promise<DatasetVersionRow[]> {
    const rows: DatasetVersionRow[] = [];
    for (let index = 0; index < version.chunkCount; index++) {
      const lines = await this.deps.versionContent.readChunk({ ...this.#address(version), index });
      for (const line of lines) rows.push(versionRowOf(line, rows.length));
    }
    return rows;
  }

  async compare(input: CompareDatasetVersionInput): Promise<DatasetVersionComparison> {
    const version = await this.get(input);
    const before = { columns: version.columnTypes, rows: await this.readWhole(version) };
    const dataset = await this.#readyDataset(input);
    const bounds = await this.deps.wholeReadBounds(input.projectId);
    const current: DatasetVersionRow[] = [];
    let bytes = 0;
    // Bounded as the rows stream: a postgres-layout dataset records no counts.
    for await (const row of this.#currentRows(dataset)) {
      bytes += Buffer.byteLength(JSON.stringify(row.entry));
      current.push(row);
      assertWithinWholeRead({ rows: current.length, bytes, ...bounds });
    }
    return compareDatasetContents({
      version: version.version,
      before,
      after: { columns: dataset.columnTypes, rows: current },
    });
  }

  /**
   * Replaces the current columns and rows with a version's, then saves the
   * result as a new version. Unsaved edits are saved first, so nothing is lost.
   */
  async restore(input: {
    projectId: string;
    datasetId: string;
    version: number;
    by: DatasetVersionAuthor;
  }): Promise<DatasetVersionRestored> {
    const target = await this.get(input);
    const dataset = await this.#readyDataset(input);
    if (isSingleFileDataset(dataset)) throw new DatasetVersionRestoreUnsupportedError();
    const { contentHash } = await this.#hashCurrent(dataset);
    if (contentHash === target.contentHash) {
      const latest = await this.deps.versions.findLatest({
        projectId: input.projectId,
        datasetId: dataset.id,
      });
      return { version: latest ?? target, changed: false };
    }

    const rows = await this.readWhole(target);
    await this.snapshot({ ...input, datasetId: dataset.id, trigger: "autosave" });
    await this.#replaceContent({ dataset, columns: target.columnTypes, rows });
    const restored = await this.snapshot({
      ...input,
      datasetId: dataset.id,
      trigger: "restore",
      restoredFromVersion: target.version,
    });
    return { version: restored.version, changed: true };
  }

  async pin(input: {
    projectId: string;
    datasetId: string;
    version: number;
  }): Promise<DatasetVersion> {
    const version = await this.get(input);
    return version.pinned
      ? version
      : this.deps.versions.pin({ projectId: input.projectId, id: version.id });
  }

  /** Removes versions and their stored rows; retention's only write. */
  async remove(input: { projectId: string; versions: readonly DatasetVersion[] }): Promise<number> {
    // Rows go first: a failure part way leaves unreachable chunks, never a listed version
    // whose rows are gone.
    const removed = await this.deps.versions.deleteMany({
      projectId: input.projectId,
      ids: input.versions.map((version) => version.id),
    });
    for (const version of input.versions) {
      await this.deps.versionContent.deleteChunks({
        ...this.#address(version),
        chunkCount: version.chunkCount,
      });
    }
    return removed;
  }

  /** Removes every version of one dataset, with its stored rows and run links. */
  async purgeDataset(input: { projectId: string; datasetId: string }): Promise<number> {
    const versions = await this.deps.versions.findAll(input);
    return this.remove({ projectId: input.projectId, versions });
  }

  /** Clears an erased user from every version they saved; the versions stay. */
  forgetAuthor(input: { userId: string }): Promise<number> {
    return this.deps.versions.forgetAuthor(input);
  }

  async #assertWholeRead(input: {
    projectId: string;
    rows: number | null;
    bytes: number | null;
  }): Promise<void> {
    const bounds = await this.deps.wholeReadBounds(input.projectId);
    assertWithinWholeRead({ rows: input.rows ?? 0, bytes: input.bytes ?? 0, ...bounds });
  }

  async #readyDataset(input: { projectId: string; datasetId: string }): Promise<Dataset> {
    const dataset = await this.deps.lookup({
      projectId: input.projectId,
      slugOrId: input.datasetId,
    });
    if (dataset.status !== "ready") {
      throw new DatasetNotReadyError({ status: dataset.status, statusError: dataset.statusError });
    }
    return dataset;
  }

  async #keepUnchanged({
    latest,
    input,
  }: {
    latest: DatasetVersion;
    input: { projectId: string; name?: string; pinned?: boolean };
  }): Promise<DatasetVersion> {
    let kept = latest;
    if (input.name !== undefined && input.name !== latest.name) {
      kept = await this.deps.versions.rename({
        projectId: input.projectId,
        id: latest.id,
        name: input.name,
      });
    }
    if (input.pinned && !kept.pinned) {
      kept = await this.deps.versions.pin({ projectId: input.projectId, id: latest.id });
    }
    return kept;
  }

  async #hashCurrent(dataset: Dataset): Promise<ReturnType<DatasetContentHasherService["digest"]>> {
    const hasher = DatasetContentHasherService.create({ columns: dataset.columnTypes });
    for await (const row of this.#currentRows(dataset)) hasher.push(row);
    return hasher.digest();
  }

  /** Writes the content again while hashing it, so the stored hash is of the stored rows. */
  async #writeVersion({
    dataset,
    latest,
    input,
  }: {
    dataset: Dataset;
    latest: DatasetVersion | null;
    input: Parameters<DatasetVersionService["snapshot"]>[0];
  }): Promise<DatasetSnapshot> {
    const id = this.deps.generateId();
    const address = { projectId: input.projectId, datasetId: dataset.id, versionId: id };
    const hasher = DatasetContentHasherService.create({ columns: dataset.columnTypes });
    let buffer: DatasetVersionRow[] = [];
    let chunkCount = 0;
    for await (const row of this.#currentRows(dataset)) {
      hasher.push(row);
      buffer.push(row);
      if (buffer.length === DATASET_VERSION_ROWS_PER_CHUNK) {
        await this.deps.versionContent.writeChunk({
          ...address,
          index: chunkCount++,
          rows: buffer,
        });
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      await this.deps.versionContent.writeChunk({ ...address, index: chunkCount++, rows: buffer });
    }
    const digest = hasher.digest();

    let previous = latest;
    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt++) {
      if (previous && previous.contentHash === digest.contentHash) {
        await this.deps.versionContent.deleteChunks({ ...address, chunkCount });
        return { version: await this.#keepUnchanged({ latest: previous, input }), created: false };
      }
      try {
        const version = await this.deps.versions.create({
          id,
          projectId: input.projectId,
          datasetId: dataset.id,
          version: (previous?.version ?? 0) + 1,
          name: input.name ?? null,
          trigger: input.trigger,
          contentHash: digest.contentHash,
          columnTypes: dataset.columnTypes,
          rowCount: digest.rowCount,
          sizeBytes: digest.sizeBytes,
          chunkCount,
          restoredFromVersion: input.restoredFromVersion ?? null,
          authorId: input.by.id,
          authorKind: input.by.kind,
          pinned: input.pinned ?? false,
        });
        await this.#announce({
          projectId: input.projectId,
          datasetId: dataset.id,
          versionId: version.id,
          version: version.version,
          trigger: version.trigger,
        });
        return { version, created: true };
      } catch (error) {
        if (!(error instanceof DatasetVersionNumberTakenError)) throw error;
        previous = await this.deps.versions.findLatest({
          projectId: input.projectId,
          datasetId: dataset.id,
        });
      }
    }
    await this.deps.versionContent.deleteChunks({ ...address, chunkCount });
    throw new Error(
      `Dataset ${dataset.id} took no version number after ${MAX_NUMBER_ATTEMPTS} tries`,
    );
  }

  /** The dataset's rows as they are now, whichever layout holds them. */
  async *#currentRows(dataset: Dataset): AsyncGenerator<DatasetVersionRow> {
    if (dataset.contentLayout === "s3_jsonl") {
      let position = 0;
      for (let index = 0; index < (dataset.chunkCount ?? 0); index++) {
        const lines = await this.deps.chunks.readChunk({
          projectId: dataset.projectId,
          datasetId: dataset.id,
          index,
        });
        for (const line of lines) yield versionRowOf(line, position++);
      }
      return;
    }
    if (isSingleFileDataset(dataset)) {
      yield* await this.deps.readSingleFile(dataset);
      return;
    }
    let cursorId: string | undefined;
    let more = true;
    while (more) {
      const page = await this.deps.records.findPage({
        datasetId: dataset.id,
        projectId: dataset.projectId,
        limit: RECORD_PAGE_SIZE,
        ...(cursorId ? { cursorId } : {}),
      });
      for (const record of page) yield { id: record.id, entry: record.entry };
      more = page.length === RECORD_PAGE_SIZE;
      cursorId = page.at(-1)?.id;
    }
  }

  async #replaceContent({
    dataset,
    columns,
    rows,
  }: {
    dataset: Dataset;
    columns: DatasetColumns;
    rows: readonly DatasetVersionRow[];
  }): Promise<void> {
    const { projectId, id: datasetId } = dataset;
    if (dataset.contentLayout === "s3_jsonl") {
      await this.deps.content.withDatasetLock(datasetId, async (tx) => {
        const writer = StreamingChunkWriterService.create({
          storage: this.deps.chunks,
          projectId,
          datasetId,
        });
        for (const row of rows) await writer.push(row.entry, { id: row.id });
        const meta = await writer.finalize();
        await this.deps.chunks.deleteChunksFrom({
          projectId,
          datasetId,
          fromIndex: meta.chunkCount,
        });
        await tx.updateContent({
          id: datasetId,
          projectId,
          content: {
            rowCount: meta.rowCount,
            sizeBytes: BigInt(meta.sizeBytes),
            chunkCount: meta.chunkCount,
            chunkOffsets: meta.chunkOffsets,
            columnTypes: columns,
          },
        });
      });
      return;
    }

    let existing: string[];
    do {
      const page = await this.deps.records.listAll({ datasetId, projectId, page: 1, limit: 1000 });
      existing = page.records.map((record) => record.id);
      if (existing.length > 0) {
        await this.deps.records.deleteMany({ datasetId, projectId, recordIds: existing });
      }
    } while (existing.length > 0);
    for (let start = 0; start < rows.length; start += RECORD_PAGE_SIZE) {
      await this.deps.records.createMany({
        datasetId,
        projectId,
        entries: rows
          .slice(start, start + RECORD_PAGE_SIZE)
          .map((row) => ({ ...row.entry, id: row.id })),
      });
    }
    await this.deps.content.update({ id: datasetId, projectId, data: { columnTypes: columns } });
    logger.info({ projectId, datasetId, rows: rows.length }, "Restored a dataset version in place");
  }

  #address(version: DatasetVersion): { projectId: string; datasetId: string; versionId: string } {
    return { projectId: version.projectId, datasetId: version.datasetId, versionId: version.id };
  }
}

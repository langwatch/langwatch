import { toDate, type Instant } from "@langwatch/time";

import type { DatasetRow } from "../dataset.repository.ts";
import type {
  CreateDatasetInput,
  DatasetContentRepository,
  DatasetContentUpdate,
  UpdateDatasetInput,
} from "../dataset-content.repository.ts";
import { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

/** The defaults a stored dataset row carries when a write did not name them. */
const STORED_DEFAULTS = {
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "postgres",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: null,
  sizeBytes: null,
  chunkCount: null,
  chunkOffsets: null,
} as const;

export class MemoryDatasetContentRepository implements DatasetContentRepository {
  #database: MemoryDatasetDatabase;
  #locked: boolean;
  #nextId = 0;

  private constructor(database: MemoryDatasetDatabase, locked: boolean) {
    this.#database = database;
    this.#locked = locked;
  }

  static create(
    input: Readonly<{ database: MemoryDatasetDatabase }>,
  ): MemoryDatasetContentRepository {
    return new MemoryDatasetContentRepository(input.database, false);
  }

  /**
   * One process holds this database, so the serialization the advisory lock
   * buys is already there; what the twin must keep is the refusal to nest,
   * which is the invariant the callers were written against.
   */
  async withDatasetLock<T>(
    _datasetId: string,
    mutate: (tx: DatasetContentRepository) => Promise<T>,
  ): Promise<T> {
    if (this.#locked) {
      throw new Error("withDatasetLock cannot nest: this repository is already transactional");
    }

    return await mutate(new MemoryDatasetContentRepository(this.#database, true));
  }

  async findOne(input: { id: string; projectId: string }): Promise<DatasetRow | null> {
    return this.#database.dataset(input.projectId, input.id) ?? null;
  }

  async getOne(input: { id: string; projectId: string }): Promise<DatasetRow> {
    const row = await this.findOne(input);
    if (!row) throw new Error(`No Dataset found for id ${input.id}`);

    return row;
  }

  async findBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
  }): Promise<DatasetRow | null> {
    return (
      this.#database
        .datasets()
        .find(
          (row) =>
            row.projectId === input.projectId &&
            row.slug === input.slug &&
            row.id !== input.excludeId,
        ) ?? null
    );
  }

  async create(input: CreateDatasetInput): Promise<DatasetRow> {
    const now = this.#database.now();
    this.#nextId += 1;
    const written = normalise(input);
    const row: DatasetRow = {
      ...STORED_DEFAULTS,
      ...written,
      id: input.id ?? `dataset_${this.#nextId}`,
      projectId: input.projectId,
      name: input.name,
      slug: input.slug,
      columnTypes: input.columnTypes,
      createdAt: written.createdAt ?? now,
      updatedAt: written.updatedAt ?? now,
    };

    this.#database.putDataset(row);

    return row;
  }

  async update(input: UpdateDatasetInput): Promise<DatasetRow> {
    const row = this.#database.dataset(input.projectId, input.id);
    if (!row) throw new Error(`No Dataset found for id ${input.id}`);

    const updated: DatasetRow = {
      ...row,
      ...normalise(input.data),
      updatedAt: this.#database.now(),
    };

    this.#database.putDataset(updated);

    return updated;
  }

  async updateContent(input: {
    id: string;
    projectId: string;
    content: DatasetContentUpdate;
  }): Promise<DatasetRow> {
    const row = this.#database.dataset(input.projectId, input.id);
    if (!row) throw new Error(`No Dataset found for id ${input.id}`);

    const updated: DatasetRow = {
      ...row,
      ...normalise(input.content),
      updatedAt: this.#database.now(),
    };

    this.#database.putDataset(updated);

    return updated;
  }

  async deletePendingUpload(input: { id: string; projectId: string }): Promise<number> {
    const row = this.#database.dataset(input.projectId, input.id);
    if (!row || row.status !== "uploading") return 0;

    return this.#database.removeDataset(input.projectId, input.id) ? 1 : 0;
  }

  async failIfProcessing(input: {
    id: string;
    projectId: string;
    statusError: string;
  }): Promise<number> {
    return await this.#guardedWrite(input, "processing", {
      status: "failed",
      statusError: input.statusError,
    });
  }

  async claimForProcessing(input: { id: string; projectId: string }): Promise<number> {
    const row = this.#database.dataset(input.projectId, input.id);
    if (!row || row.status !== "uploading" || row.archivedAt) return 0;

    this.#database.putDataset({ ...row, status: "processing", updatedAt: this.#database.now() });

    return 1;
  }

  async markProcessingRedriven(input: { id: string; projectId: string }): Promise<number> {
    return await this.#guardedWrite(input, "processing", { statusError: null });
  }

  async findStaleProcessing(input: {
    projectId: string;
    olderThan: Instant;
  }): Promise<DatasetRow[]> {
    const cutoff = toDate(input.olderThan).getTime();

    return this.#database
      .datasets()
      .filter(
        (row) =>
          row.projectId === input.projectId &&
          row.status === "processing" &&
          !row.archivedAt &&
          row.stagingKey !== null &&
          row.updatedAt.getTime() < cutoff,
      );
  }

  async findPendingUploadByStagingKey(input: {
    projectId: string;
    stagingKey: string;
  }): Promise<DatasetRow | null> {
    return (
      this.#database
        .datasets()
        .find(
          (row) =>
            row.projectId === input.projectId &&
            row.stagingKey === input.stagingKey &&
            row.status === "uploading" &&
            !row.archivedAt,
        ) ?? null
    );
  }

  async findStalePendingUploads(input: {
    projectId: string;
    olderThan: Instant;
  }): Promise<DatasetRow[]> {
    const cutoff = toDate(input.olderThan).getTime();

    return this.#database
      .datasets()
      .filter(
        (row) =>
          row.projectId === input.projectId &&
          row.status === "uploading" &&
          !row.archivedAt &&
          row.createdAt.getTime() < cutoff,
      );
  }

  async findAllSlugs(input: { projectId: string }): Promise<Array<{ slug: string }>> {
    return this.#database
      .datasets()
      .filter((row) => row.projectId === input.projectId)
      .map((row) => ({ slug: row.slug }));
  }

  async listPaginated(input: { projectId: string; skip: number; take: number }): Promise<{
    datasets: Array<DatasetRow & { _count: { datasetRecords: number } }>;
    total: number;
  }> {
    const matching = this.#database
      .datasets()
      .filter((row) => row.projectId === input.projectId && !row.archivedAt);

    const page = [...matching]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.skip, input.skip + input.take);

    return {
      datasets: page.map((row) => ({
        ...row,
        _count: {
          // Skipped for object-backed datasets, whose count is a column — the
          // same rule the Prisma twin applies before it groups.
          datasetRecords:
            row.contentLayout === "s3_jsonl" || row.useS3
              ? 0
              : this.#database
                  .records()
                  .filter(
                    (record) =>
                      record.projectId === row.projectId && record.datasetId === row.id,
                  ).length,
        },
      })),
      total: matching.length,
    };
  }

  /** A status-guarded write: matches nothing and reports 0 when the row moved on. */
  async #guardedWrite(
    input: { id: string; projectId: string },
    status: string,
    data: Partial<DatasetRow>,
  ): Promise<number> {
    const row = this.#database.dataset(input.projectId, input.id);
    if (!row || row.status !== status) return 0;

    this.#database.putDataset({ ...row, ...data, updatedAt: this.#database.now() });

    return 1;
  }
}

/** The write fields a stored row takes, with the two time inputs made dates. */
function normalise(
  fields: Readonly<Record<string, unknown>>,
): Partial<DatasetRow> {
  const written: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === "projectId") continue;
    if (key === "createdAt" || key === "updatedAt" || key === "archivedAt") {
      written[key] = value === null ? null : toDate(value as Instant);
      continue;
    }
    if (key === "sizeBytes" && typeof value === "number") {
      written[key] = BigInt(value);
      continue;
    }
    written[key] = value;
  }

  return written as Partial<DatasetRow>;
}

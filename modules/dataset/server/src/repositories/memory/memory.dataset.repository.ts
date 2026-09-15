import {
  datasetColumnsSchema,
  datasetSchema,
  type Dataset,
  type DatasetSummary,
} from "@langwatch/dataset-contract";
import { toDate, type Instant } from "@langwatch/time";

import type { DatasetRow } from "../dataset.repository.ts";
import type {
  DatasetCreateInput,
  DatasetRepository,
  DatasetUpdateInput,
} from "../dataset.repository.ts";
import { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

/** The same projection the Prisma twin returns rows through. */
export function toDataset(row: DatasetRow): Dataset {
  return datasetSchema.parse({
    ...row,
    columnTypes: datasetColumnsSchema.parse(row.columnTypes),
    archivedAt: row.archivedAt ?? null,
    mapping: row.mapping ?? null,
  });
}

export class MemoryDatasetRepository implements DatasetRepository {
  #database: MemoryDatasetDatabase;
  #nextId = 0;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ database: MemoryDatasetDatabase }>): MemoryDatasetRepository {
    return new MemoryDatasetRepository(input.database);
  }

  async findById(input: {
    id: string;
    projectId: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null> {
    const row = this.#database.dataset(input.projectId, input.id);
    if (!row) return null;
    if (!input.includeArchived && row.archivedAt) return null;

    return toDataset(row);
  }

  async findBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null> {
    const row = this.#database
      .datasets()
      .find(
        (candidate) =>
          candidate.projectId === input.projectId &&
          candidate.slug === input.slug &&
          candidate.id !== input.excludeId &&
          (input.includeArchived === true || !candidate.archivedAt),
      );

    return row ? toDataset(row) : null;
  }

  async list(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<DatasetSummary[]> {
    const rows = this.#database
      .datasets()
      .filter((row) => row.projectId === input.projectId && !row.archivedAt)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice((input.page - 1) * input.limit, input.page * input.limit);

    return rows.map((row) => ({
      ...toDataset(row),
      recordCount: this.#database
        .records()
        .filter((record) => record.projectId === row.projectId && record.datasetId === row.id)
        .length,
    }));
  }

  async create(input: DatasetCreateInput): Promise<Dataset> {
    const now = this.#database.now();
    this.#nextId += 1;
    const row: DatasetRow = {
      id: `dataset_${this.#nextId}`,
      projectId: input.projectId,
      name: input.name,
      slug: input.slug,
      columnTypes: input.columnTypes,
      createdAt: now,
      updatedAt: now,
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
    };

    this.#database.putDataset(row);

    return toDataset(row);
  }

  async update(input: DatasetUpdateInput): Promise<Dataset> {
    const row = this.#require(input.projectId, input.id, "updating");
    const updated: DatasetRow = {
      ...row,
      name: input.name,
      slug: input.slug,
      columnTypes: input.columnTypes,
      updatedAt: this.#database.now(),
    };

    this.#database.putDataset(updated);

    return toDataset(updated);
  }

  async archive(input: {
    id: string;
    projectId: string;
    slug: string;
    archivedAt: Instant | null;
  }): Promise<Dataset> {
    const row = this.#require(input.projectId, input.id, "archiving");
    const updated: DatasetRow = {
      ...row,
      slug: input.slug,
      archivedAt: input.archivedAt ? toDate(input.archivedAt) : null,
      updatedAt: this.#database.now(),
    };

    this.#database.putDataset(updated);

    return toDataset(updated);
  }

  async restore(input: { id: string; projectId: string; slug: string }): Promise<Dataset> {
    const row = this.#require(input.projectId, input.id, "restoring");
    const updated: DatasetRow = {
      ...row,
      slug: input.slug,
      archivedAt: null,
      updatedAt: this.#database.now(),
    };

    this.#database.putDataset(updated);

    return toDataset(updated);
  }

  async updateMapping(input: {
    id: string;
    projectId: string;
    mapping: Record<string, unknown>;
  }): Promise<Dataset> {
    const row = this.#require(input.projectId, input.id, "updating mapping");
    const updated: DatasetRow = {
      ...row,
      mapping: input.mapping,
      updatedAt: this.#database.now(),
    };

    this.#database.putDataset(updated);

    return toDataset(updated);
  }

  async count(input: { projectId: string; slug: string }): Promise<number> {
    return this.#database
      .datasets()
      .filter((row) => row.projectId === input.projectId && row.slug === input.slug).length;
  }

  /** The same refusal the Prisma twin raises when its guarded write matches nothing. */
  #require(projectId: string, id: string, action: string): DatasetRow {
    const row = this.#database.dataset(projectId, id);
    if (!row) throw new Error(`Dataset was not found while ${action}`);

    return row;
  }
}

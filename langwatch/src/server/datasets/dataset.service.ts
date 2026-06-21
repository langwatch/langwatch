import { generate } from "@langwatch/ksuid";
import type { DatasetRecord, Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { tryToMapPreviousColumnsToNewColumns } from "~/optimization_studio/utils/datasetUtils";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";
import { slugify } from "~/utils/slugify";
import {
  adaptS3JsonlRecord,
  createManyDatasetRecords,
  getFullDataset,
} from "../api/routers/datasetRecord.utils";
import { DatasetRepository } from "./dataset.repository";
import type { ChunkOffset } from "./dataset-chunking";
import {
  appendS3JsonlRecords,
  deleteS3JsonlRecords,
  editS3JsonlRecord,
  writeInitialS3JsonlChunks,
} from "./dataset-mutations";
import { enqueueDatasetNormalize } from "./dataset-normalize.queue";
import { DatasetRecordRepository } from "./dataset-record.repository";
import { getDatasetStorage } from "./dataset-storage";
import {
  DatasetConflictError,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetNotRetryableError,
  InvalidColumnError,
  MalformedColumnTypesError,
  StagedUploadNotFoundError,
  UploadNotPendingError,
  UploadTooLargeError,
} from "./errors";
import { ExperimentRepository } from "./experiment.repository";
import { exceedsUploadCap } from "./presigned-upload";
import { stripNullBytes } from "./sanitize";
import type {
  DatasetColumns,
  DatasetRecordEntry,
  DatasetRecordInput,
} from "./types";
import {
  convertRowsToColumnTypes,
  detectFileFormat,
  MAX_FILE_SIZE_BYTES,
  MAX_ROWS_LIMIT,
  parseFileContent,
  renameReservedColumns,
} from "./upload-utils";

const logger = createLogger("langwatch:datasets:service");

/**
 * Result type for paginated dataset listings.
 */
export type ListDatasetsResult = {
  data: Array<{
    id: string;
    name: string;
    slug: string;
    columnTypes: unknown;
    createdAt: Date;
    updatedAt: Date;
    recordCount: number;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

/**
 * Service input types for business operations
 */
export type UpsertDatasetParams = {
  projectId: string;
  name?: string;
  experimentId?: string;
  columnTypes: DatasetColumns;
  datasetId?: string;
  // Input records - IDs are optional (backend generates them with nanoid)
  datasetRecords?: DatasetRecordInput[];
};

export type ValidateDatasetNameParams = {
  projectId: string;
  proposedName: string;
  excludeDatasetId?: string;
};

export type ValidateDatasetNameResult = {
  available: boolean;
  slug: string;
  conflictsWith?: string;
};

/**
 * Service layer for dataset business logic.
 * Single Responsibility: Dataset lifecycle management and slug synchronization.
 *
 * Framework-agnostic - no tRPC dependencies.
 * Throws domain-specific errors that can be mapped by the router layer.
 */
export class DatasetService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DatasetRepository,
    private readonly recordRepository: DatasetRecordRepository,
    private readonly experimentRepository: ExperimentRepository,
  ) {}

  /**
   * Static factory method for creating a DatasetService with proper DI.
   */
  static create(prisma: PrismaClient): DatasetService {
    const repository = new DatasetRepository(prisma);
    const recordRepository = new DatasetRecordRepository(prisma);
    const experimentRepository = new ExperimentRepository(prisma);
    return new DatasetService(
      prisma,
      repository,
      recordRepository,
      experimentRepository,
    );
  }

  /**
   * Creates a new dataset or updates an existing one.
   *
   * Business rules:
   * - For updates: Auto-syncs slug with name, handles column type migrations
   * - For creates: Generates unique slug, checks conflicts, configures S3
   * - If no name provided, generates from experiment name
   *
   * @throws {DatasetNotFoundError} if updating non-existent dataset
   * @throws {DatasetConflictError} if creating with duplicate slug
   */
  async upsertDataset(params: UpsertDatasetParams) {
    const {
      projectId,
      name,
      experimentId,
      columnTypes,
      datasetId,
      datasetRecords,
    } = params;

    // Resolve the dataset name
    const resolvedName =
      name ?? (await this.resolveExperimentName(projectId, experimentId));

    if (datasetId) {
      return await this.updateExistingDataset({
        datasetId,
        projectId,
        name: resolvedName,
        columnTypes,
      });
    }

    return await this.createNewDataset({
      projectId,
      name: resolvedName,
      columnTypes,
      datasetRecords,
    });
  }

  /**
   * Updates an existing dataset with new name, slug, and column types.
   * Handles column type migrations by remapping existing records.
   *
   * @throws {DatasetNotFoundError} if dataset doesn't exist
   * @throws {DatasetConflictError} if slug collides with another dataset
   */
  private async updateExistingDataset(params: {
    datasetId: string;
    projectId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) {
    const { datasetId, projectId, name, columnTypes } = params;

    return await this.prisma.$transaction(async (tx) => {
      // Get existing dataset for column comparison
      const existingDataset = await this.repository.findOne(
        {
          id: datasetId,
          projectId,
        },
        { tx },
      );

      if (!existingDataset) {
        throw new DatasetNotFoundError();
      }

      const slug = this.generateSlug(name);

      // Check for slug collision with other datasets (excluding current one)
      const conflictingDataset = await this.repository.findBySlug(
        {
          slug,
          projectId,
          excludeId: datasetId,
        },
        { tx },
      );

      if (conflictingDataset) {
        throw new DatasetConflictError();
      }

      // Migrate records if column schema changed
      if (
        JSON.stringify(existingDataset.columnTypes) !==
        JSON.stringify(columnTypes)
      ) {
        // ADR-032: column migration rewrites every record's keys — for s3_jsonl
        // that's a chunk-rewrite (write-mutation), which is a later rung. The PG
        // record migrator would read zero rows (I-PG) and silently "migrate"
        // nothing, leaving stored chunk keys out of sync with columnTypes.
        // Refuse rather than corrupt. (Deferred: s3_jsonl column migration.)
        if (existingDataset.contentLayout === "s3_jsonl") {
          throw new Error(
            "Changing column types is not yet supported for large (S3) datasets",
          );
        }
        await this.migrateDatasetRecordColumns(
          {
            datasetId,
            projectId,
            oldColumnTypes: existingDataset.columnTypes as DatasetColumns,
            newColumnTypes: columnTypes,
          },
          { tx },
        );
      }

      // Update the dataset (repository validates ownership - will throw if datasetId doesn't belong to projectId)
      return await this.repository.update(
        {
          id: datasetId,
          projectId,
          data: {
            name,
            slug,
            columnTypes,
          },
        },
        { tx },
      );
    });
  }

  /**
   * Creates a new dataset with a generated slug and optional records.
   *
   * Born-on-storage (ADR-032 cutover step 1): every new dataset is created
   * directly in the chunked-JSONL layout — S3 when configured, else the local
   * filesystem (`resolveProjectStorageDestination` always returns a backend) —
   * so `contentLayout='postgres'` is never created for new data and the backfill
   * drains to zero. Records are wrapped `{ id, entry }` (the same shape the
   * append/normalize paths write) and flushed to chunk objects from index 0,
   * then the row is created with PG-authoritative counters and `status='ready'`
   * (the write is synchronous, so there is no async-normalize `processing`
   * window).
   *
   * Atomicity: chunks are written BEFORE the row exists, so a chunk-write
   * failure throws and leaves no orphan row (the "name already exists" trap the
   * old record-insert transaction guarded against). No advisory lock is taken —
   * the row doesn't exist yet, so there is nothing to serialize against.
   *
   * @throws {DatasetConflictError} if slug already exists
   */
  private async createNewDataset(params: {
    projectId: string;
    name: string;
    columnTypes: DatasetColumns;
    datasetRecords?: DatasetRecordInput[];
  }) {
    const { projectId, name, columnTypes, datasetRecords } = params;

    const slug = this.generateSlug(name);

    const existingDataset = await this.repository.findBySlug({
      slug,
      projectId,
    });

    if (existingDataset) {
      throw new DatasetConflictError();
    }

    const datasetId = `dataset_${nanoid()}`;

    // Drop any caller-supplied id (s3_jsonl rows are addressed by their
    // chunk-line id, minted by writeInitialS3JsonlChunks). The {id,entry} wrap +
    // U+0000 scrub (I-NULL) lives in dataset-mutations alongside the append path.
    const entries = (datasetRecords ?? []).map((record) => {
      const { id: _id, ...entry } = record;
      return entry;
    });

    // Born-on-storage: write the chunk objects BEFORE the row exists, so a
    // write failure throws and leaves no orphan row.
    const meta = await writeInitialS3JsonlChunks({
      projectId,
      datasetId,
      entries,
    });

    return await this.repository.create({
      id: datasetId,
      slug,
      name,
      projectId,
      columnTypes,
      contentLayout: "s3_jsonl",
      status: "ready",
      rowCount: meta.rowCount,
      sizeBytes: BigInt(meta.sizeBytes),
      chunkCount: meta.chunkCount,
      chunkOffsets: meta.chunkOffsets as unknown as Prisma.InputJsonValue,
    });
  }

  /**
   * Migrates dataset records when column types change.
   */
  private async migrateDatasetRecordColumns(
    params: {
      datasetId: string;
      projectId: string;
      oldColumnTypes: DatasetColumns;
      newColumnTypes: DatasetColumns;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<void> {
    const { datasetId, projectId, oldColumnTypes, newColumnTypes } = params;

    const datasetRecords = await this.recordRepository.findDatasetRecords(
      {
        datasetId,
        projectId,
      },
      options,
    );

    const updatedEntries = tryToMapPreviousColumnsToNewColumns(
      datasetRecords.map((record) => record.entry as DatasetRecordEntry),
      oldColumnTypes,
      newColumnTypes,
    );

    if (updatedEntries.length !== datasetRecords.length) {
      throw new Error(
        `Column migration failed: expected ${datasetRecords.length} records but got ${updatedEntries.length}`,
      );
    }

    await this.recordRepository.updateDatasetRecordsTransaction(
      projectId,
      datasetRecords.map((record, index) => ({
        id: record.id,
        entry: updatedEntries[index]!,
      })),
      options,
    );
  }

  /**
   * Validates a dataset name by computing its slug and checking availability.
   */
  async validateDatasetName(
    params: ValidateDatasetNameParams,
  ): Promise<ValidateDatasetNameResult> {
    const { projectId, proposedName, excludeDatasetId } = params;

    const slug = this.generateSlug(proposedName);

    const existingDataset = await this.repository.findBySlug({
      slug,
      projectId,
      excludeId: excludeDatasetId,
    });

    return {
      available: !existingDataset,
      slug,
      conflictsWith: existingDataset?.name,
    };
  }

  /**
   * Finds next available name for a dataset to avoid conflicts.
   * Public method for the findNextName endpoint.
   */
  async findNextAvailableName(
    projectId: string,
    proposedName: string,
  ): Promise<string> {
    const datasets = await this.repository.findAllSlugs({ projectId });
    const slugSet = new Set(datasets.map((d) => d.slug));

    let index = 1;
    let candidateName: string;

    while (true) {
      candidateName = index === 1 ? proposedName : `${proposedName} (${index})`;
      const candidateSlug = this.generateSlug(candidateName);

      if (!slugSet.has(candidateSlug)) {
        return candidateName;
      }

      index++;
    }
  }

  /**
   * Generates a slug from a dataset name.
   * Format: lowercase, kebab-case, alphanumeric + hyphens only
   */
  private generateSlug(name: string): string {
    return slugify(name.replaceAll("_", "-"), {
      lower: true,
      strict: true,
    });
  }

  /**
   * Resolves dataset name from experiment if not explicitly provided.
   * Generates next available name to avoid conflicts.
   */
  private async resolveExperimentName(
    projectId: string,
    experimentId?: string,
  ): Promise<string> {
    if (!experimentId) {
      return "Draft Dataset";
    }

    const experiment = await this.experimentRepository.findExperiment({
      id: experimentId,
      projectId,
    });

    const baseName = experiment?.name ?? "Draft Dataset";
    return await this.findNextAvailableNameInternal(projectId, baseName);
  }

  /**
   * Finds next available dataset name by appending (2), (3), etc.
   * if the base name already exists in the project.
   * Private helper for experiment name resolution.
   */
  private async findNextAvailableNameInternal(
    projectId: string,
    baseName: string,
  ): Promise<string> {
    const datasets = await this.repository.findAllSlugs({ projectId });
    const slugSet = new Set(datasets.map((d) => d.slug));

    let index = 1;
    let candidateName: string;

    while (true) {
      candidateName = index === 1 ? baseName : `${baseName} (${index})`;
      const candidateSlug = this.generateSlug(candidateName);

      if (!slugSet.has(candidateSlug)) {
        return candidateName;
      }

      index++;
    }
  }
  /**
   * Resolves a dataset by slug or id within a project.
   * Only returns non-archived datasets.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   */
  async getBySlugOrId(params: { slugOrId: string; projectId: string }) {
    const dataset = await this.repository.findBySlugOrId(params);
    if (!dataset) {
      throw new DatasetNotFoundError();
    }
    return dataset;
  }

  /**
   * Lists non-archived datasets for a project with pagination and record counts.
   */
  async listDatasets(params: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<ListDatasetsResult> {
    const { projectId, page, limit } = params;
    const skip = (page - 1) * limit;

    const { datasets, total } = await this.repository.listPaginated({
      projectId,
      skip,
      take: limit,
    });

    return {
      data: datasets.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        columnTypes: d.columnTypes,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        recordCount: d._count.datasetRecords,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Archives a dataset (soft-delete) by setting archivedAt and mutating its slug.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   */
  async archiveDataset(params: { slugOrId: string; projectId: string }) {
    const dataset = await this.getBySlugOrId(params);
    const slug = this.generateSlug(dataset.name);

    await this.repository.update({
      id: dataset.id,
      projectId: params.projectId,
      data: {
        slug: `${slug}-archived-${nanoid()}`,
        archivedAt: new Date(),
      },
    });

    return { id: dataset.id, archived: true as const };
  }

  /**
   * Lists records for a dataset with pagination.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   */
  async listRecords(params: {
    slugOrId: string;
    projectId: string;
    page: number;
    limit: number;
  }) {
    const dataset = await this.getBySlugOrId({
      slugOrId: params.slugOrId,
      projectId: params.projectId,
    });

    const skip = (params.page - 1) * params.limit;

    // ADR-032: s3_jsonl content lives in chunk objects, not the PG
    // DatasetRecord table (I-PG → zero PG rows), so the PG-only paginator would
    // silently return empty. Gate on ready (I-READY / Decision 6), then read
    // ONLY the chunk(s) whose [startRow, endRow) overlap the requested
    // page×limit window (via the PG-authoritative `chunkOffsets`) — I-MEM, so a
    // page request never reads non-overlapping chunks of a multi-GB dataset.
    if (dataset.contentLayout === "s3_jsonl") {
      if (dataset.status !== "ready") {
        throw new DatasetNotReadyError({
          status: dataset.status,
          statusError: dataset.statusError,
        });
      }

      const storage = await getDatasetStorage(params.projectId);
      // PG-authoritative count (Decision 1/2); fall back to chunkCount-driven read.
      const total = dataset.rowCount ?? 0;
      const windowStart = skip;
      const windowEnd = skip + params.limit; // exclusive

      const offsets: ChunkOffset[] = Array.isArray(dataset.chunkOffsets)
        ? (dataset.chunkOffsets as unknown as ChunkOffset[])
        : [];

      // Read only the chunks overlapping [windowStart, windowEnd). With offsets
      // present this touches at most ⌈limit / rows-per-chunk⌉ + 1 chunks.
      // Defensive fallback (legacy rows with no offsets): read every chunk in
      // order, but still slice the page — no offsets means we can't locate the
      // window cheaply, the same bound legacy data already lived under.
      const pageRecords: DatasetRecord[] = [];
      if (offsets.length > 0) {
        const overlapping = offsets.filter(
          (o) => o.startRow < windowEnd && o.endRow > windowStart,
        );
        for (const offset of overlapping) {
          const rows = await storage.readChunk({
            projectId: params.projectId,
            datasetId: dataset.id,
            index: offset.index,
          });
          rows.forEach((line, within) => {
            const globalRow = offset.startRow + within;
            if (globalRow >= windowStart && globalRow < windowEnd) {
              pageRecords.push(adaptS3JsonlRecord(line, dataset));
            }
          });
        }
      } else {
        const rows = await storage.readChunks({
          projectId: params.projectId,
          datasetId: dataset.id,
          chunkCount: dataset.chunkCount ?? 0,
        });
        const records = rows.map((line) => adaptS3JsonlRecord(line, dataset));
        pageRecords.push(...records.slice(windowStart, windowEnd));
      }

      return {
        data: pageRecords,
        pagination: {
          page: params.page,
          limit: params.limit,
          total,
          totalPages: Math.ceil(total / params.limit),
        },
      };
    }

    const { records, total } = await this.recordRepository.listPaginated({
      datasetId: dataset.id,
      projectId: params.projectId,
      skip,
      take: params.limit,
    });

    return {
      data: records,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  /**
   * Upserts a record within a dataset: updates if it exists, creates if it doesn't.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   * @returns `{ record, created }` where created indicates if a new record was made
   */
  async upsertRecord(params: {
    slugOrId: string;
    projectId: string;
    recordId: string;
    entry: Prisma.InputJsonValue;
  }) {
    const dataset = await this.getBySlugOrId({
      slugOrId: params.slugOrId,
      projectId: params.projectId,
    });

    const sanitisedEntry = stripNullBytes(
      params.entry,
    ) as Prisma.InputJsonValue;

    // ADR-032 rung 6b: s3_jsonl content lives in chunk objects (I-PG → zero PG
    // rows), so the upsert is a chunk-rewrite (edit existing id) or chunk-append
    // (new id), serialized by the per-dataset advisory lock (Decision 9). The
    // returned record mirrors the PG shape for the editor UI.
    if (dataset.contentLayout === "s3_jsonl") {
      const { updated } = await editS3JsonlRecord({
        prisma: this.prisma,
        dataset,
        projectId: params.projectId,
        recordId: params.recordId,
        entry: sanitisedEntry,
      });
      const record = {
        id: params.recordId,
        entry: sanitisedEntry as Prisma.JsonValue,
        datasetId: dataset.id,
        projectId: params.projectId,
        createdAt: dataset.createdAt,
        updatedAt: new Date(),
      };
      return { record, created: !updated };
    }

    const existing = await this.recordRepository.findOne({
      id: params.recordId,
      datasetId: dataset.id,
      projectId: params.projectId,
    });

    if (existing) {
      const updated = await this.recordRepository.updateEntry({
        id: params.recordId,
        datasetId: dataset.id,
        projectId: params.projectId,
        entry: sanitisedEntry,
      });
      return { record: updated, created: false };
    }

    const created = await this.recordRepository.create({
      id: params.recordId,
      datasetId: dataset.id,
      projectId: params.projectId,
      entry: sanitisedEntry,
    });
    return { record: created, created: true };
  }

  /**
   * Batch creates records for a dataset.
   *
   * Business rules:
   * - Validates column names against dataset schema, rejects unknown columns
   * - Fills missing columns with null
   * - Generates nanoid() IDs for each record
   *
   * @throws {DatasetNotFoundError} if dataset not found
   * @returns the created records with IDs and timestamps
   */
  async batchCreateRecords(params: {
    slugOrId: string;
    projectId: string;
    entries: Array<Record<string, unknown>>;
  }) {
    const dataset = await this.getBySlugOrId({
      slugOrId: params.slugOrId,
      projectId: params.projectId,
    });

    const rawColumns = dataset.columnTypes;
    if (
      !Array.isArray(rawColumns) ||
      !rawColumns.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).name === "string",
      )
    ) {
      throw new MalformedColumnTypesError(dataset.name);
    }

    const datasetColumns = rawColumns as DatasetColumns;
    const validColumnNames = new Set(datasetColumns.map((c) => c.name));

    // Validate column names across all entries
    for (const entry of params.entries) {
      for (const key of Object.keys(entry)) {
        if (!validColumnNames.has(key)) {
          throw new InvalidColumnError({
            columnName: key,
            datasetName: dataset.name,
            validColumns: [...validColumnNames],
          });
        }
      }
    }

    // Build records with missing columns filled as null and generated IDs.
    // stripNullBytes guards Postgres jsonb against U+0000 in user-supplied
    // string values (Postgres error 22P05).
    const records = params.entries.map((entry) => {
      const fullEntry: Record<string, unknown> = {};
      for (const col of datasetColumns) {
        fullEntry[col.name] = entry[col.name] ?? null;
      }
      return {
        id: generate(KSUID_RESOURCES.DATASET_RECORD).toString(),
        entry: stripNullBytes(fullEntry) as Prisma.InputJsonValue,
      };
    });

    // ADR-032 rung 6b: an s3_jsonl dataset appends to chunk objects (new chunks
    // from `chunkCount`), not the PG table (I-PG), under the per-dataset advisory
    // lock (Decision 9). The shared column validation/fill above is reused; only
    // the persistence target differs.
    if (dataset.contentLayout === "s3_jsonl") {
      await appendS3JsonlRecords({
        prisma: this.prisma,
        dataset,
        projectId: params.projectId,
        entries: records.map((r) => r.entry),
      });
      const createdAt = new Date();
      return records.map((record) => ({
        id: record.id,
        entry: record.entry as Prisma.JsonValue,
        createdAt,
      }));
    }

    const created = await this.recordRepository.createMany({
      records,
      datasetId: dataset.id,
      projectId: params.projectId,
    });

    return created.map((record) => ({
      id: record.id,
      entry: record.entry,
      createdAt: record.createdAt,
    }));
  }

  /**
   * Batch deletes records from a dataset.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   * @returns the count of deleted records
   */
  async deleteRecords(params: {
    slugOrId: string;
    projectId: string;
    recordIds: string[];
  }) {
    const dataset = await this.getBySlugOrId({
      slugOrId: params.slugOrId,
      projectId: params.projectId,
    });

    // ADR-032 rung 6b: s3_jsonl rows live in chunk objects (I-PG), so a delete
    // rewrites the affected chunk(s) without the removed rows and recomputes the
    // offset index, under the per-dataset advisory lock (Decision 9).
    if (dataset.contentLayout === "s3_jsonl") {
      const { deleted } = await deleteS3JsonlRecords({
        prisma: this.prisma,
        dataset,
        projectId: params.projectId,
        recordIds: params.recordIds,
      });
      return { count: deleted };
    }

    const { count } = await this.recordRepository.deleteMany({
      recordIds: params.recordIds,
      datasetId: dataset.id,
      projectId: params.projectId,
    });

    return { count };
  }

  /**
   * Gets a dataset with all its records, resolving by slug or id.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   */
  async getDatasetWithRecords(params: {
    slugOrId: string;
    projectId: string;
    limitMb?: number | null;
  }) {
    const dataset = await this.getBySlugOrId(params);

    const result = await getFullDataset({
      datasetId: dataset.id,
      projectId: params.projectId,
      limitMb: params.limitMb ?? null,
    });

    if (!result) {
      throw new DatasetNotFoundError();
    }

    return {
      dataset,
      records: result.datasetRecords,
      truncated: result.truncated ?? false,
    };
  }

  /**
   * Copies a dataset to a target project.
   * Handles name conflicts by appending a suffix.
   * Copies all records with correct structure.
   */
  async copyDataset(params: {
    sourceDatasetId: string;
    sourceProjectId: string;
    targetProjectId: string;
  }) {
    const { sourceDatasetId, sourceProjectId, targetProjectId } = params;

    const sourceDataset = await this.repository.findOne({
      id: sourceDatasetId,
      projectId: sourceProjectId,
    });

    if (!sourceDataset) {
      throw new DatasetNotFoundError();
    }

    // Fetch source records. ADR-032: an s3_jsonl source has its content in chunk
    // objects, not the PG DatasetRecord table (I-PG), so reading PG would copy
    // an empty dataset. Gate on ready (I-READY) and read the chunks instead.
    // NOTE: reads all chunks in memory; large-dataset copy is bounded by the
    // reads-at-scale fast-follow, same as every other read in this rung.
    let sourceRecordEntries: Array<Record<string, unknown>>;
    if (sourceDataset.contentLayout === "s3_jsonl") {
      if (sourceDataset.status !== "ready") {
        throw new DatasetNotReadyError({
          status: sourceDataset.status,
          statusError: sourceDataset.statusError,
        });
      }
      const storage = await getDatasetStorage(sourceProjectId);
      const rows = await storage.readChunks({
        projectId: sourceProjectId,
        datasetId: sourceDatasetId,
        chunkCount: sourceDataset.chunkCount ?? 0,
      });
      // Reuse the shared {id, entry} → DatasetRecord adapter (the same unwrap the
      // read paths use) and take just the entry; the copy mints fresh ids below.
      sourceRecordEntries = rows.map(
        (line) =>
          adaptS3JsonlRecord(line, sourceDataset).entry as Record<
            string,
            unknown
          >,
      );
    } else {
      const sourceRecords = await this.recordRepository.findDatasetRecords({
        datasetId: sourceDatasetId,
        projectId: sourceProjectId,
      });
      sourceRecordEntries = sourceRecords.map(
        (record) => record.entry as Record<string, unknown>,
      );
    }

    // Determine new name
    const newName = await this.findNextAvailableName(
      targetProjectId,
      sourceDataset.name,
    );

    // Create new dataset. The copy target is created on the PG layout (the
    // createNewDataset default); routing the copy *target* onto s3_jsonl is a
    // write-mutation concern for a later rung — this rung only fixes reads.
    const newDataset = await this.createNewDataset({
      projectId: targetProjectId,
      name: newName,
      columnTypes: sourceDataset.columnTypes as DatasetColumns,
      datasetRecords: sourceRecordEntries.map((entry) => ({
        ...entry,
        id: nanoid(),
      })),
    });

    return newDataset;
  }

  /**
   * Uploads a file to an existing dataset.
   *
   * Parses the file, validates columns match, converts types, and creates records.
   *
   * @throws {DatasetNotFoundError} if dataset not found
   * @throws {UploadValidationError} if columns don't match, file too large, too many rows, etc.
   */
  async uploadToExistingDataset(params: {
    slugOrId: string;
    projectId: string;
    filename: string;
    content: string;
    fileSize: number;
  }) {
    const { slugOrId, projectId, filename, content, fileSize } = params;

    // Validate file size
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      throw new UploadValidationError(
        `File size exceeds the maximum limit of 25MB`,
        "file_too_large",
      );
    }

    // Detect format and parse
    const format = detectFileFormat(filename);
    const { headers, rows } = parseFileContent({ content, format });

    // Validate non-empty
    if (rows.length === 0) {
      throw new UploadValidationError(
        "File contains no data rows",
        "empty_file",
      );
    }

    // Validate row limit
    if (rows.length > MAX_ROWS_LIMIT) {
      throw new UploadValidationError(
        `File contains ${rows.length} rows, which exceeds the maximum limit of ${MAX_ROWS_LIMIT}`,
        "row_limit_exceeded",
      );
    }

    // Resolve dataset
    const dataset = await this.getBySlugOrId({ slugOrId, projectId });
    const datasetColumns = dataset.columnTypes as DatasetColumns;

    // Validate columns match
    const expectedColumns = new Set(datasetColumns.map((c) => c.name));
    const uploadedColumns = new Set(headers);

    const missingColumns = [...uploadedColumns].filter(
      (c) => !expectedColumns.has(c),
    );
    const extraColumns = [...expectedColumns].filter(
      (c) => !uploadedColumns.has(c),
    );

    if (missingColumns.length > 0 || extraColumns.length > 0) {
      const parts: string[] = [];
      if (missingColumns.length > 0) {
        parts.push(`unexpected columns: ${missingColumns.join(", ")}`);
      }
      if (extraColumns.length > 0) {
        parts.push(`missing columns: ${extraColumns.join(", ")}`);
      }
      throw new UploadValidationError(
        `Uploaded columns do not match the dataset schema. ${parts.join("; ")}`,
        "column_mismatch",
      );
    }

    // Convert types
    const convertedRows = convertRowsToColumnTypes(rows, datasetColumns);

    // Create records
    const now = Date.now();
    const datasetRecords: DatasetRecordInput[] = convertedRows.map(
      (row, index) => ({
        id: `${now}-${index}`,
        ...row,
      }),
    );

    await createManyDatasetRecords({
      datasetId: dataset.id,
      projectId,
      datasetRecords,
    });

    return {
      datasetId: dataset.id,
      recordsCreated: datasetRecords.length,
    };
  }

  /**
   * Creates a new dataset from an uploaded file.
   *
   * Parses the file, infers columns (all as "string"), renames reserved columns,
   * creates the dataset and records.
   *
   * @throws {DatasetConflictError} if slug conflicts
   * @throws {UploadValidationError} if file too large, too many rows, etc.
   */
  /**
   * R3: start a direct browser→S3 upload for a NEW dataset. Checks the name
   * conflict FIRST (C2 — a conflict must never mint a presigned URL), then
   * mints the presigned target (fails fast with `DirectUploadUnavailableError`
   * on backends that can't presign — caller falls back to backend upload),
   * then creates the `Dataset` in `uploading` with the minted staging key
   * bound to the row (C1). Content lands in S3 once the normalize job runs
   * (rung 4); `columnTypes` is unknown until then.
   */
  async createPendingUpload(params: {
    projectId: string;
    name: string;
    filename: string;
  }): Promise<{
    datasetId: string;
    slug: string;
    uploadUrl: string;
    stagingKey: string;
  }> {
    const { projectId, name, filename } = params;

    const slug = this.generateSlug(name);
    // C2: reject a name conflict before minting a presigned URL so a duplicate
    // name never produces a usable upload target.
    if (await this.repository.findBySlug({ slug, projectId })) {
      throw new DatasetConflictError();
    }

    const storage = await getDatasetStorage(projectId);
    // Throws DirectUploadUnavailableError on local/no-S3 → no orphan row.
    const upload = await storage.createPresignedUpload({ projectId });

    const dataset = await this.repository.create({
      id: `dataset_${nanoid()}`,
      slug,
      name,
      projectId,
      columnTypes: [], // unknown until normalize parses the uploaded file
      status: "uploading",
      contentLayout: "s3_jsonl",
      // C1: bind the minted key to the row so finalize never trusts a
      // client-supplied key.
      stagingKey: upload.key,
      // Required at presign (M1) so the normalize job can always detect the
      // file format — the staged object carries no original filename.
      uploadFilename: filename,
    });

    return {
      datasetId: dataset.id,
      slug: dataset.slug,
      uploadUrl: upload.url,
      stagingKey: upload.key,
    };
  }

  /**
   * Abort a still-pending direct upload: archive the `uploading` dataset row and
   * best-effort delete its staged object. Used by the browser when the presigned
   * PUT fails (CORS / network) so a failed attempt doesn't leave a stuck
   * `uploading` row before the modal falls back to the backend path.
   *
   * Gated to `status='uploading'`: a finalized (`processing`/`ready`/`failed`)
   * dataset has real content or is mid-normalize and must NOT be reaped by this
   * cleanup path — those are deleted through the normal archive route.
   *
   * @throws {DatasetNotFoundError} if the dataset is missing or archived
   * @throws {UploadNotPendingError} if the dataset is not in `uploading`
   */
  async abortPendingUpload(params: {
    projectId: string;
    datasetId: string;
  }): Promise<{ datasetId: string; aborted: true }> {
    const { projectId, datasetId } = params;

    const dataset = await this.repository.findOne({ id: datasetId, projectId });
    if (!dataset || dataset.archivedAt) {
      throw new DatasetNotFoundError();
    }
    // Only a pending upload can be aborted — never reap a dataset that already
    // holds (or is normalizing) content.
    if (dataset.status !== "uploading") {
      throw new UploadNotPendingError();
    }

    // Best-effort delete of the staged object — non-fatal (the staging lifecycle
    // rule reaps it otherwise; a failed delete must not block the cleanup).
    if (dataset.stagingKey) {
      try {
        const storage = await getDatasetStorage(projectId);
        await storage.deleteStaged({ projectId, key: dataset.stagingKey });
      } catch {
        // ignore
      }
    }

    const slug = this.generateSlug(dataset.name);
    await this.repository.update({
      id: datasetId,
      projectId,
      data: {
        slug: `${slug}-archived-${nanoid()}`,
        archivedAt: new Date(),
      },
    });

    return { datasetId, aborted: true };
  }

  /**
   * R3: finalize a direct upload. The staging key is read from the dataset row
   * (C1 — never trust a client-supplied key); finalize is gated to datasets in
   * `uploading` (C1 — blocks finalize replay), enforces the size cap (HEAD;
   * deletes the staged object when over-cap, ADR D4/M6), and flips the dataset
   * to `processing`. The normalize job is enqueued from here in rung 4.
   *
   * @throws {DatasetNotFoundError} if the dataset is missing or archived
   * @throws {UploadNotPendingError} if the dataset is not in `uploading`
   * @throws {StagedUploadNotFoundError} if the staged object is missing/incomplete
   * @throws {UploadTooLargeError} if the staged object exceeds the size cap
   */
  async finalizeUpload(params: {
    projectId: string;
    datasetId: string;
  }): Promise<{ datasetId: string; status: "processing" }> {
    const { projectId, datasetId } = params;

    const dataset = await this.repository.findOne({ id: datasetId, projectId });
    // C1: not found OR archived is not finalizable.
    if (!dataset || dataset.archivedAt) {
      throw new DatasetNotFoundError();
    }
    // C1: only a pending upload can be finalized; blocks re-finalizing a
    // processing/ready dataset (finalize replay).
    if (dataset.status !== "uploading") {
      throw new UploadNotPendingError();
    }
    // C1: the staging key is the server-minted one bound to the row, not a
    // client param. A null key means the row was never set up for direct
    // upload — not finalizable.
    const stagingKey = dataset.stagingKey;
    if (!stagingKey) {
      throw new UploadNotPendingError("Dataset has no pending staged upload");
    }

    const storage = await getDatasetStorage(projectId);

    let sizeBytes: number;
    try {
      sizeBytes = await storage.headStagedObjectSize({
        projectId,
        key: stagingKey,
      });
    } catch (error: unknown) {
      // M5: a never-completed upload shouldn't sit stuck in `uploading` — flip
      // it to failed before surfacing the not-found error.
      if (error instanceof StagedUploadNotFoundError) {
        await this.repository.update({
          id: datasetId,
          projectId,
          data: { status: "failed", statusError: "Uploaded object not found" },
        });
      }
      throw error;
    }

    if (exceedsUploadCap(sizeBytes)) {
      // M6 / ADR D4: reject AND delete the over-cap staged object (best-effort;
      // a failed delete must not mask the size rejection).
      try {
        await storage.deleteStaged({ projectId, key: stagingKey });
      } catch {
        // non-fatal: the staging lifecycle rule reaps it eventually.
      }
      await this.repository.update({
        id: datasetId,
        projectId,
        data: { status: "failed", statusError: "Uploaded file is too large" },
      });
      throw new UploadTooLargeError();
    }

    await this.repository.update({
      id: datasetId,
      projectId,
      data: { status: "processing" },
    });

    // ADR-032 D5: enqueue the normalize GroupQueue job (or inline-run it when no
    // worker/queue is present). It streams the staged object → chunked JSONL and
    // flips the dataset to `ready`. tenantId === projectId (datasets are
    // project-scoped and the event-sourcing tenant IS the project). The filename
    // drives format detection; M1 makes it required at presign, so
    // `uploadFilename` is always set — the `.jsonl` fallback is purely defensive
    // for a legacy row created before M1.
    //
    // M4: fire-and-forget — never block the HTTP response on normalization. In
    // prod the GroupQueue producer `.send()` is non-blocking; the no-Redis
    // memory-queue and inline modes would otherwise run the whole normalize
    // inside the finalize request (violating ADR D5 "no synchronous-in-request"
    // for the single-node self-host shape). The client polls `processing`.
    void enqueueDatasetNormalize({
      prisma: this.prisma,
      payload: {
        id: datasetId,
        tenantId: projectId,
        projectId,
        datasetId,
        stagingKey,
        filename: dataset.uploadFilename ?? `${datasetId}.jsonl`,
      },
    }).catch((error: unknown) => {
      logger.error({ error, datasetId }, "failed to enqueue normalize");
    });

    return { datasetId, status: "processing" };
  }

  /**
   * I-RECOVER: manually retry normalization of a stuck/failed dataset. A
   * `failed` dataset (or one wedged at `processing` after a worker death) is
   * re-runnable — there's no other way to recover it, since the handler no-ops
   * anything not `processing`. Flips the dataset back to `processing` (clearing
   * the prior error) and re-enqueues the normalize job from the row's bound
   * staging key.
   *
   * @throws {DatasetNotFoundError} if the dataset is missing or archived
   * @throws {DatasetNotRetryableError} if the dataset is not `failed`/`processing`
   *   or has no staging key to re-read (no source to normalize)
   */
  async retryNormalize(params: {
    projectId: string;
    datasetId: string;
  }): Promise<{ datasetId: string; status: "processing" }> {
    const { projectId, datasetId } = params;

    const dataset = await this.repository.findOne({ id: datasetId, projectId });
    if (!dataset || dataset.archivedAt) {
      throw new DatasetNotFoundError();
    }
    // Only a failed (or wedged-processing) dataset is retryable; a `ready` or
    // still-`uploading` dataset has nothing to re-drive.
    if (dataset.status !== "failed" && dataset.status !== "processing") {
      throw new DatasetNotRetryableError();
    }
    // No staging key → no source to normalize from.
    const stagingKey = dataset.stagingKey;
    if (!stagingKey) {
      throw new DatasetNotRetryableError(
        "Dataset has no staged upload to retry",
      );
    }

    await this.repository.update({
      id: datasetId,
      projectId,
      data: { status: "processing", statusError: null },
    });

    // M4: fire-and-forget — don't block the retry HTTP response on the
    // normalize (see finalizeUpload). The same payload shape finalize uses.
    void enqueueDatasetNormalize({
      prisma: this.prisma,
      payload: {
        id: datasetId,
        tenantId: projectId,
        projectId,
        datasetId,
        stagingKey,
        filename: dataset.uploadFilename ?? `${datasetId}.jsonl`,
      },
    }).catch((error: unknown) => {
      logger.error({ error, datasetId }, "failed to enqueue normalize retry");
    });

    return { datasetId, status: "processing" };
  }

  async createDatasetFromUpload(params: {
    projectId: string;
    name: string;
    filename: string;
    content: string;
    fileSize: number;
  }) {
    const { projectId, name, filename, content, fileSize } = params;

    // Validate file size
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      throw new UploadValidationError(
        `File size exceeds the maximum limit of 25MB`,
        "file_too_large",
      );
    }

    // Detect format and parse
    const format = detectFileFormat(filename);
    const { headers, rows } = parseFileContent({ content, format });

    // Validate non-empty
    if (rows.length === 0) {
      throw new UploadValidationError(
        "File contains no data rows",
        "empty_file",
      );
    }

    // Validate row limit
    if (rows.length > MAX_ROWS_LIMIT) {
      throw new UploadValidationError(
        `File contains ${rows.length} rows, which exceeds the maximum limit of ${MAX_ROWS_LIMIT}`,
        "row_limit_exceeded",
      );
    }

    // Rename reserved columns
    const renamedHeaders = renameReservedColumns(headers);

    // Build column rename mapping
    const renameMap = new Map<string, string>();
    headers.forEach((original, i) => {
      if (original !== renamedHeaders[i]) {
        renameMap.set(original, renamedHeaders[i]!);
      }
    });

    // Apply renames to rows if needed
    const renamedRows =
      renameMap.size > 0
        ? rows.map((row) => {
            const newRow: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) {
              const newKey = renameMap.get(key) ?? key;
              newRow[newKey] = value;
            }
            return newRow;
          })
        : rows;

    // Infer column types (all as "string")
    const columnTypes: DatasetColumns = renamedHeaders.map((h) => ({
      name: h,
      type: "string" as const,
    }));

    // Create the dataset via existing method
    const now = Date.now();
    const datasetRecords: DatasetRecordInput[] = renamedRows.map(
      (row, index) => ({
        id: `${now}-${index}`,
        ...row,
      }),
    );

    const dataset = await this.createNewDataset({
      projectId,
      name,
      columnTypes,
      datasetRecords,
    });

    return {
      id: dataset.id,
      name: dataset.name,
      slug: dataset.slug,
      columnTypes: dataset.columnTypes,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
      recordsCreated: datasetRecords.length,
    };
  }
}

/**
 * Error thrown for upload validation failures (column mismatch, file too large, etc.)
 * Uses a `kind` field for safe cross-boundary identification.
 */
export class UploadValidationError extends Error {
  readonly kind:
    | "column_mismatch"
    | "file_too_large"
    | "row_limit_exceeded"
    | "empty_file"
    | "unsupported_format";

  constructor(
    message: string,
    kind:
      | "column_mismatch"
      | "file_too_large"
      | "row_limit_exceeded"
      | "empty_file"
      | "unsupported_format",
  ) {
    super(message);
    this.name = "UploadValidationError";
    this.kind = kind;
  }
}

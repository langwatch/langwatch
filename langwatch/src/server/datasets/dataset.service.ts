import type { Readable } from "node:stream";
import { generate } from "@langwatch/ksuid";
import type {
  Dataset,
  DatasetRecord,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { tryToMapPreviousColumnsToNewColumns } from "~/optimization_studio/utils/datasetUtils";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";
import { slugify } from "~/utils/slugify";
import {
  adaptS3JsonlRecord,
  assertDatasetReadableInHeap,
  createManyDatasetRecords,
  getFullDataset,
} from "../api/routers/datasetRecord.utils";
import { DatasetRepository } from "./dataset.repository";
import type { ChunkOffset } from "./dataset-chunking";
import {
  DATASET_MUTATION_TXN_MAX_WAIT_MS,
  DATASET_MUTATION_TXN_TIMEOUT_MS,
} from "./dataset-lock";
import {
  appendS3JsonlRecords,
  deleteAllS3JsonlChunks,
  deleteS3JsonlRecords,
  editS3JsonlRecord,
  migrateS3JsonlColumns,
  writeInitialS3JsonlChunks,
} from "./dataset-mutations";
import { enqueueDatasetNormalize } from "./dataset-normalize.queue";
import { DatasetRecordRepository } from "./dataset-record.repository";
import { getDatasetStorage } from "./dataset-storage";
import {
  ColumnTypeChangeNotSupportedError,
  DatasetChunkCountMissingError,
  DatasetConflictError,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetNotRetryableError,
  DirectUploadUnavailableError,
  InvalidColumnError,
  MalformedColumnTypesError,
  StagedUploadNotFoundError,
  UploadNotPendingError,
  UploadTooLargeError,
} from "./errors";
import { ExperimentRepository } from "./experiment.repository";
import {
  exceedsUploadCap,
  STALE_PENDING_UPLOAD_TTL_SECONDS,
  STALE_PROCESSING_TTL_SECONDS,
  stagingUploadKey,
  UPLOAD_MAX_BYTES,
} from "./presigned-upload";
import { datasetDisplayRecordCount } from "./record-count";
import { stripNullBytes } from "./sanitize";
import type {
  DatasetColumns,
  DatasetConfirmColumns,
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

    // s3_jsonl column changes (rename / retype / add / remove) are a chunk
    // rewrite under the per-dataset advisory lock (ADR-032 v19) — which owns its
    // own transaction and so can't run inside the `$transaction` below. Handle it
    // up front; the lock re-reads + re-validates the row under it. (Reads here are
    // outside the lock, so this is a fast pre-check, not the authoritative gate.)
    const preexisting = await this.repository.findOne({
      id: datasetId,
      projectId,
    });
    if (!preexisting) {
      throw new DatasetNotFoundError();
    }
    if (preexisting.status != null && preexisting.status !== "ready") {
      throw new DatasetNotReadyError({
        status: preexisting.status,
        statusError: preexisting.statusError,
      });
    }
    const columnsChanged =
      JSON.stringify(preexisting.columnTypes) !== JSON.stringify(columnTypes);
    if (columnsChanged && preexisting.contentLayout === "s3_jsonl") {
      const slug = this.generateSlug(name);
      const conflictingDataset = await this.repository.findBySlug({
        slug,
        projectId,
        excludeId: datasetId,
      });
      if (conflictingDataset) {
        throw new DatasetConflictError();
      }
      return await migrateS3JsonlColumns({
        prisma: this.prisma,
        dataset: preexisting,
        projectId,
        oldColumnTypes: preexisting.columnTypes as DatasetColumns,
        newColumnTypes: columnTypes,
        name,
        slug,
        repository: this.repository,
      });
    }

    return await this.prisma.$transaction(
      async (tx) => {
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

        // Defense in depth for the UI's ready-gate: editing a dataset that is still
        // `uploading`/`processing` (or `failed`) races the normalize job and edits
        // content that isn't settled. Refuse unless ready (a null status = legacy =
        // ready). The datasets-page menu hides Edit for non-ready rows; this stops a
        // direct/stale call too.
        if (
          existingDataset.status != null &&
          existingDataset.status !== "ready"
        ) {
          throw new DatasetNotReadyError({
            status: existingDataset.status,
            statusError: existingDataset.statusError,
          });
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

        const existingColumns = existingDataset.columnTypes as DatasetColumns;
        const columnsChanged =
          JSON.stringify(existingColumns) !== JSON.stringify(columnTypes);

        // Defensive: s3_jsonl column changes are handled up front via
        // `migrateS3JsonlColumns` (the advisory-lock chunk rewrite) and return
        // before this transaction (ADR-032 v19). Reaching here with s3_jsonl and a
        // changed schema would mean that early branch regressed — refuse rather
        // than run the PG record migrator, which would read zero rows (I-PG) and
        // silently corrupt nothing into the chunk store.
        if (existingDataset.contentLayout === "s3_jsonl" && columnsChanged) {
          throw new ColumnTypeChangeNotSupportedError();
        }

        // Only rewrite row data when the column KEY structure changes
        // (rename / add / remove / reorder). In the legacy postgres layout the
        // stored `entry` JSON is untyped — column types are metadata — and the
        // record migrator (`tryToMapPreviousColumnsToNewColumns`) only remaps
        // keys, never values. So a type-only change (e.g. string→image) would
        // rewrite every row with byte-identical JSON: O(rowCount) UPDATEs of pure
        // no-ops, which is exactly what blew the transaction budget. Skip it and
        // let the `dataset.update` below persist the new types alone. The
        // `columnsChanged` short-circuit means a name-only edit never reaches
        // `columnKeysChanged` (and so never reads/maps the stored column array).
        if (
          columnsChanged &&
          this.columnKeysChanged(existingColumns, columnTypes)
        ) {
          await this.migrateDatasetRecordColumns(
            {
              datasetId,
              projectId,
              oldColumnTypes: existingColumns,
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
      },
      {
        // Safety net for the remaining heavy case: a column rename / add / remove
        // still runs `migrateDatasetRecordColumns` here — one `datasetRecord.update`
        // per row across the whole dataset — which can exceed Prisma's 5s default
        // interactive-txn timeout and P2028 ("Transaction already closed"). Type-only
        // changes no longer reach the migrator (see `columnKeysChanged` above), so
        // this budget only ever covers genuine structural rewrites. Mirrors the
        // s3_jsonl chunk-rewrite path (`withDatasetLock`).
        timeout: DATASET_MUTATION_TXN_TIMEOUT_MS,
        maxWait: DATASET_MUTATION_TXN_MAX_WAIT_MS,
      },
    );
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

    // Split each record into its entry (id stripped) and its caller-supplied id,
    // index-aligned. We HONOR a pinned id (SDK/MCP/REST may set one for a later
    // edit/delete or for idempotency) and mint a fresh `record_<nanoid>` only
    // where absent — the same contract the append path already provides via
    // `forcedIds`. The `{id,entry}` wrap + U+0000 scrub (I-NULL) lives in
    // dataset-mutations alongside the append path.
    const records = datasetRecords ?? [];
    const entries = records.map((record) => {
      const { id: _id, ...entry } = record;
      return entry;
    });
    const forcedIds = records.map((record) => record.id);

    // Resolve storage once and thread it through the write AND the failure reap,
    // so the reap can never target a different backend than the write if the
    // project's storage config flips mid-call.
    const storage = await getDatasetStorage(projectId);

    // Born-on-storage: write the chunk objects BEFORE the row exists, so a
    // write failure throws and leaves no orphan row. A PARTIAL write (chunk 0
    // lands, chunk 1 throws) self-reaps inside writeInitialS3JsonlChunks, so we
    // only have to guard the row insert here.
    const meta = await writeInitialS3JsonlChunks({
      projectId,
      datasetId,
      entries,
      forcedIds,
      storage,
    });

    try {
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
    } catch (error) {
      // The chunks were written before this row. If the insert fails (a slug
      // race → `@@unique([projectId, slug])` violation, or a DB outage) the
      // objects are orphaned — customer content in storage with no row to govern
      // its retention/deletion. `datasetId` is a fresh nanoid scoped to THIS
      // attempt, so the reap only ever targets this losing attempt's chunks,
      // never a concurrent winner's. Best-effort, then surface the failure.
      await deleteAllS3JsonlChunks({ projectId, datasetId, storage }).catch(
        () => {
          // best-effort: a failed reap must not mask the original insert error
        },
      );
      throw error;
    }
  }

  /**
   * Whether the column KEY structure changed (the SET of names), as opposed to
   * only the declared types or their order. The legacy record migrator remaps by
   * name first and only falls back to position for names that have no match — so
   * when the name sets are equal every column maps to itself and the rewrite is a
   * guaranteed no-op on every row's keys. That covers both a type-only change and
   * a pure reorder (column order is `dataset.columnTypes` metadata, persisted by
   * the `dataset.update` regardless; it never lives in the row JSON), so neither
   * needs a row rewrite. Compare sorted names so order alone doesn't trigger it.
   */
  private columnKeysChanged(
    oldColumns: DatasetColumns,
    newColumns: DatasetColumns,
  ): boolean {
    const oldNames = oldColumns.map((c) => c.name).sort();
    const newNames = newColumns.map((c) => c.name).sort();
    return JSON.stringify(oldNames) !== JSON.stringify(newNames);
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
        // s3_jsonl rows live in chunks, not the DatasetRecord table — count via
        // the layout-aware helper so new datasets don't report 0.
        recordCount: datasetDisplayRecordCount(d),
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

      // Validate the offsets index before trusting it to drive page selection.
      // A malformed/partial JSON (e.g. an interrupted migration that somehow
      // committed a half-written array) would otherwise produce NaN comparisons
      // → an empty page against a positive rowCount (silent data loss) or an
      // `index: undefined` passed to readChunk. On bad data, fall THROUGH to the
      // offsets-absent repair branch (read every chunk + slice) rather than
      // serve a wrong page. The offsets-absent branch already throws loudly on a
      // null chunkCount, so a genuinely-broken dataset surfaces, not silences.
      const rawOffsets = Array.isArray(dataset.chunkOffsets)
        ? (dataset.chunkOffsets as unknown as ChunkOffset[])
        : [];
      const offsetsValid =
        rawOffsets.length > 0 &&
        rawOffsets.every(
          (o) =>
            o != null &&
            Number.isInteger(o.index) &&
            Number.isFinite(o.startRow) &&
            Number.isFinite(o.endRow) &&
            o.endRow >= o.startRow,
        );
      const offsets: ChunkOffset[] = offsetsValid ? rawOffsets : [];

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
        // No chunkOffsets (legacy/partial migration): the only way to honour the
        // page window is to read every chunk, then slice — an UNBOUNDED read per
        // page. Guard on sizeBytes so a large offset-less dataset can't OOM the
        // pod on a normal list call (offsets-present datasets take the bounded
        // branch above).
        assertDatasetReadableInHeap(dataset);
        // I-COUNT: same guard as getFullDataset — a `ready` s3_jsonl dataset MUST
        // have a non-null chunkCount. `chunkCount ?? 0` would loop zero times and
        // serve an EMPTY page against a positive rowCount (silent data loss); the
        // offsets branch above never reaches here, so this only fires on genuine
        // drift. Throw loudly so it surfaces (and recomputeDatasetCounts repairs).
        if (dataset.chunkCount == null) {
          throw new DatasetChunkCountMissingError(dataset.id);
        }
        const rows = await storage.readChunks({
          projectId: params.projectId,
          datasetId: dataset.id,
          chunkCount: dataset.chunkCount,
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
        repository: this.repository,
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
      // Persist the SAME ids we mint and return below — `forcedIds` pins each
      // chunk-line id to `record.id`, so a follow-up edit/delete by the returned
      // id actually targets the stored row (without this, append minted its own
      // ids and the returned ones existed nowhere).
      await appendS3JsonlRecords({
        prisma: this.prisma,
        dataset,
        projectId: params.projectId,
        entries: records.map((r) => r.entry),
        forcedIds: records.map((r) => r.id),
        repository: this.repository,
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
        repository: this.repository,
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
    // NOTE: reads all chunks in memory until the streaming-copy fast-follow —
    // so guard on sizeBytes (same ceiling as export) to reject a too-large copy
    // rather than OOM the pod.
    let sourceRecordEntries: Array<Record<string, unknown>>;
    if (sourceDataset.contentLayout === "s3_jsonl") {
      if (sourceDataset.status !== "ready") {
        throw new DatasetNotReadyError({
          status: sourceDataset.status,
          statusError: sourceDataset.statusError,
        });
      }
      assertDatasetReadableInHeap(sourceDataset);
      // I-COUNT: a ready s3_jsonl source MUST have a non-null chunkCount; `?? 0`
      // would read zero chunks and silently copy an EMPTY dataset against a
      // positive rowCount. Mirror getFullDataset/listRecords — throw, don't
      // truncate (no offsets branch here, so chunkCount always governs the read).
      if (sourceDataset.chunkCount == null) {
        throw new DatasetChunkCountMissingError(sourceDatasetId);
      }
      const storage = await getDatasetStorage(sourceProjectId);
      const rows = await storage.readChunks({
        projectId: sourceProjectId,
        datasetId: sourceDatasetId,
        chunkCount: sourceDataset.chunkCount,
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

    // Create the copy target via createNewDataset, which is born-on-storage
    // (contentLayout='s3_jsonl', v13): the copied rows are written straight to
    // chunk objects, never to the PG records table.
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
   * R3: start a direct browser→S3 upload for a NEW dataset. Checks the name
   * conflict FIRST (C2 — a conflict must never mint a presigned URL), then
   * mints the presigned target (fails fast with `DirectUploadUnavailableError`
   * on backends that can't presign — caller falls back to backend upload),
   * then creates the `Dataset` in `uploading` with the minted staging key
   * bound to the row (C1). Content lands in S3 once the normalize job runs
   * (rung 4); `columnTypes` is unknown until then.
   *
   * Opportunistically reaps this project's abandoned prior uploads and re-drives
   * any wedged-`processing` rows first (no scheduler — the poll-triggered
   * cleanup; see `reapStalePendingUploads` + `reapStaleProcessing`).
   */
  async createPendingUpload(params: {
    projectId: string;
    name: string;
    filename: string;
    /**
     * User-confirmed columns from the upload confirm step (ADR-032 v19): the
     * normalize job binds each file header to its column and renames +
     * type-converts each record to match. The confirm UI sends the richer shape
     * carrying each column's immutable `sourceHeader` (reorder/rename-safe
     * binding); legacy callers may send the bare name+type shape (normalize then
     * falls back to positional binding). Omitted by non-UI callers (SDK / REST /
     * API key) that don't run the confirm step — normalize then derives
     * all-`string` columns as before. Stored transiently on the row; normalize
     * strips `sourceHeader` and persists a clean `DatasetColumns`.
     */
    columnTypes?: DatasetConfirmColumns | DatasetColumns;
  }): Promise<{
    datasetId: string;
    slug: string;
    uploadUrl: string;
  }> {
    const { projectId, name, filename, columnTypes } = params;

    // Bound the accumulation of abandoned `uploading` rows + staging objects and
    // recover any normalize wedged at `processing` (lost-after-send) as new
    // uploads start. Best-effort. The pending sweep is *awaited on purpose*: it
    // archives same-named abandoned `uploading` rows, freeing their slug BEFORE
    // the name-conflict check below (else a same-name retry would spuriously
    // 409). The processing re-drive has no such coupling — it only re-enqueues
    // OTHER wedged rows — so fire it off the hot path (it swallows its own
    // errors, so `void` can't throw today — the inline `.catch` is
    // belt-and-suspenders so a future throw added ABOVE its internal try/catch
    // (e.g. param validation) can't become an unhandled rejection.
    await this.reapStalePendingUploads(projectId);
    void this.reapStaleProcessing(projectId).catch((err) => {
      logger.warn({ projectId, err }, "reapStaleProcessing failed (non-fatal)");
    });

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
      // Confirmed columns (names + types) from the upload step drive normalize's
      // rename + type conversion (ADR-032 v19). Empty when the caller skipped
      // confirm (SDK / REST / API key) — normalize then derives all-`string`.
      columnTypes: columnTypes ?? [],
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
    };
  }

  /**
   * Server-side deposit for the local-FS direct upload: stream the raw file the
   * browser PUT to the same-origin staging route into the storage backend's
   * staging slot. Only backends that route uploads THROUGH the app (local FS)
   * implement `putStaged`; on S3 the browser PUTs to the bucket directly, so a
   * call here means the route was hit on a backend that doesn't deposit through
   * the app — surface `DirectUploadUnavailableError` (mapped to 409). The size
   * cap (`UPLOAD_MAX_BYTES`) is enforced mid-stream so a client can't fill the
   * disk before finalize's HEAD would reject it.
   *
   * Gated on an owning pending-upload row: we only stream into a `staging/` slot
   * that a `status='uploading'` dataset created via `createPendingUpload` claims
   * (the key is server-minted and bound to the row at presign). Without this an
   * authed project user could stream arbitrary 5 GB orphans into
   * `staging/{projectId}/…` that no lifecycle (abort/finalize) ever reaps — local
   * FS has no staging-TTL sweep — growing the disk unbounded.
   *
   * @throws {DirectUploadUnavailableError} if the backend deposits direct (S3)
   * @throws {UploadNotPendingError} if no pending upload row owns the staging key
   * @throws {UploadTooLargeError} if the stream exceeds the size cap
   */
  async writeStagedUpload(params: {
    projectId: string;
    uploadId: string;
    body: Readable;
  }): Promise<void> {
    const { projectId, uploadId, body } = params;
    const storage = await getDatasetStorage(projectId);
    if (!storage.putStaged) {
      throw new DirectUploadUnavailableError();
    }
    const stagingKey = stagingUploadKey(projectId, uploadId);
    const pending = await this.repository.findPendingUploadByStagingKey({
      projectId,
      stagingKey,
    });
    if (!pending) {
      throw new UploadNotPendingError();
    }
    await storage.putStaged({
      projectId,
      key: stagingKey,
      body,
      maxBytes: UPLOAD_MAX_BYTES,
    });
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

    const deleted = await this.reapPendingUpload(dataset);
    if (deleted === 0) {
      // TOCTOU: a finalize raced between the `status==='uploading'` read above
      // and the status-guarded delete, flipping the row to `processing`. The
      // status guard correctly spared the now-live dataset, so we do NOT throw
      // (the user's cancel simply lost the race) — but log it so this rare
      // false-"aborted" (the UI thinks it cancelled while the dataset finishes
      // processing) is observable instead of silent.
      logger.warn(
        { projectId, datasetId },
        "abortPendingUpload deleted no row — a finalize likely won the race; dataset is no longer pending",
      );
    }

    return { datasetId, aborted: true };
  }

  /**
   * Reap one pending (`uploading`, non-archived) upload row: best-effort delete
   * its staged object, then HARD-DELETE the row. A pending upload never received
   * content — the browser PUT failed/was abandoned, or finalize never ran — so
   * there is nothing to retain. Earlier this *archived* the row (rename slug +
   * `archivedAt`), which left a content-less ghost per failed direct upload: in a
   * bucket-CORS outage the drawer silently falls back for small files yet still
   * mints+orphans a row each time, so they accumulated unbounded (the "double
   * rows in PG" — the archived placeholder alongside the fallback's real
   * dataset). Deleting frees the slug naturally and leaves nothing behind; the
   * repo guards the delete on `status='uploading'` so a finalize racing this call
   * is never destroyed. The staged-object delete is non-fatal — the S3 staging
   * lifecycle rule (IaC) reaps it otherwise; a failed delete must never block the
   * row delete. Shared by the explicit abort (`abortPendingUpload`) and the
   * poll-triggered sweep (`reapStalePendingUploads`). The caller owns the
   * `status='uploading'` guard.
   */
  private async reapPendingUpload(dataset: Dataset): Promise<number> {
    const { id: datasetId, projectId } = dataset;
    if (dataset.stagingKey) {
      try {
        const storage = await getDatasetStorage(projectId);
        await storage.deleteStaged({ projectId, key: dataset.stagingKey });
      } catch {
        // ignore — best-effort; the lifecycle rule is the durable backstop
      }
    }

    // Returns the rows deleted (0 = a finalize raced and the status guard
    // spared the now-live row); the explicit-abort caller logs that case.
    return await this.repository.deletePendingUpload({
      id: datasetId,
      projectId,
    });
  }

  /**
   * Poll-triggered cleanup of abandoned pending uploads: archive every
   * `status='uploading'` row in the project older than
   * `STALE_PENDING_UPLOAD_TTL_SECONDS` and best-effort delete its staging
   * object. Runs opportunistically when a new upload starts (NOT a scheduler —
   * this epic deliberately adds no cron; see the normalize-recovery decision),
   * so accumulation is bounded for any project that keeps uploading. Wholly
   * best-effort: any failure is swallowed so it can never block the upload that
   * triggered it. The conservative TTL guarantees a still-in-flight upload is
   * never reaped. The durable backstop for a project that never uploads again is
   * the S3 `staging/` lifecycle rule (IaC).
   */
  private async reapStalePendingUploads(projectId: string): Promise<void> {
    try {
      const olderThan = new Date(
        Date.now() - STALE_PENDING_UPLOAD_TTL_SECONDS * 1000,
      );
      const stale = await this.repository.findStalePendingUploads({
        projectId,
        olderThan,
      });
      for (const dataset of stale) {
        try {
          await this.reapPendingUpload(dataset);
        } catch {
          // one bad row must not abort the rest of the sweep
        }
      }
    } catch {
      // sweep is opportunistic — never let it block the triggering upload
    }
  }

  /**
   * Poll-triggered re-drive of a normalize wedged at `processing`: a row whose
   * job vanished WITHOUT flipping it (worker died / pod killed / Redis lost the
   * job after a successful `.send()`) — the *lost-after-send* window no enqueue
   * catch can see. Re-drives normalize for every `processing` row older than
   * `STALE_PROCESSING_TTL_SECONDS`; the staged source + filename are intact and
   * normalize is idempotent (the I-IDEM handler guard + concurrency-1 group make
   * a re-drive of a still-running job a queued no-op, so a false positive is
   * harmless). `markProcessingRedriven` then bumps `updatedAt` so the row isn't
   * re-selected until the TTL re-elapses (otherwise every upload within the
   * window re-enqueues the same rows).
   *
   * SCOPE (no overclaim): this is *same-project, poll-triggered* recovery, NOT a
   * durable backstop — it only fires on this project's next `createPendingUpload`
   * (no cron, by epic decision). A project that uploads once, loses the job, and
   * never returns stays wedged; its only recovery is then the `retryNormalize`
   * API. Unlike a stale *pending* upload (whose S3 `staging/` lifecycle rule is
   * an object-level net), a wedged *processing* row has no durable backstop.
   * WARN-logged so a vanished job is visible, not silently masked.
   */
  private async reapStaleProcessing(projectId: string): Promise<void> {
    try {
      const olderThan = new Date(
        Date.now() - STALE_PROCESSING_TTL_SECONDS * 1000,
      );
      const stale = await this.repository.findStaleProcessing({
        projectId,
        olderThan,
      });
      for (const dataset of stale) {
        try {
          // findStaleProcessing already filters stagingKey != null; a present
          // key with no filename is a corrupt row (M1 co-sets them) — skip
          // rather than re-drive with a format-detection guess.
          if (!dataset.stagingKey || !dataset.uploadFilename) continue;
          logger.warn(
            { datasetId: dataset.id, projectId },
            "re-driving normalize for a dataset wedged in processing (lost job)",
          );
          this.enqueueNormalize({
            projectId,
            datasetId: dataset.id,
            stagingKey: dataset.stagingKey,
            filename: dataset.uploadFilename,
            logContext: "failed to re-enqueue normalize for a wedged dataset",
          });
          // After the re-drive (not before — a bump failure must not prevent the
          // re-enqueue), stamp updatedAt so the next sweep within the TTL skips
          // this row. Guarded on still-processing so it can't resurrect a row
          // that just raced to ready/failed.
          await this.repository.markProcessingRedriven({
            id: dataset.id,
            projectId,
          });
        } catch {
          // one bad row must not abort the rest of the sweep
        }
      }
    } catch {
      // opportunistic — never let it block the triggering upload
    }
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
    // M1: the filename is required at presign and co-set with the staging key,
    // so a present key with no filename is a corrupt row. Fail loudly rather
    // than falling back to a `.jsonl` guess — a silent mis-detection would parse
    // a CSV as JSONL and corrupt every row.
    const filename = dataset.uploadFilename;
    if (!filename) {
      throw new UploadNotPendingError(
        "Dataset upload is missing its filename — cannot detect file format",
      );
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
      // it to failed before surfacing the not-found error. Null the stagingKey
      // too (parity with the over-cap branch below): the staged object isn't
      // there, so there is no source to re-read. Leaving the key set lets
      // retryNormalize re-drive a missing object — it HEADs, throws
      // StagedUploadNotFound again, re-fails, and each Retry click queues another
      // doomed normalize. Nulling it makes retry hit DatasetNotRetryableError
      // immediately; the user must re-upload.
      if (error instanceof StagedUploadNotFoundError) {
        await this.repository.update({
          id: datasetId,
          projectId,
          data: {
            status: "failed",
            statusError: "Uploaded object not found",
            stagingKey: null,
          },
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
      // Null the stagingKey in the same update: the staged object was just
      // deleted, so the row no longer has a source to re-read. Leaving the key
      // set would make retryNormalize accept this `failed` dataset and re-drive
      // a deleted object, failing with the misleading "Uploaded object not
      // found" instead of the real over-cap cause. An over-cap upload is not
      // retryable — the user must upload a smaller file.
      await this.repository.update({
        id: datasetId,
        projectId,
        data: {
          status: "failed",
          statusError: "Uploaded file is too large",
          stagingKey: null,
        },
      });
      throw new UploadTooLargeError();
    }

    // Atomic uploading→processing transition: the WHERE-guarded `updateMany` is
    // the concurrency gate. Two finalize calls racing (double-click / retry)
    // both passed the `status==='uploading'` read above, but only one wins the
    // claim — the loser sees `claimed === 0` and bails as a finalize replay, so
    // exactly one normalize is enqueued (a read-then-update would let both
    // enqueue and, in inline mode, race two handlers onto the same chunk keys).
    const claimed = await this.repository.claimForProcessing({
      id: datasetId,
      projectId,
    });
    if (claimed === 0) {
      throw new UploadNotPendingError();
    }

    // ADR-032 D5: enqueue the normalize GroupQueue job (fire-and-forget, with
    // synchronous-failure recovery — see `enqueueNormalize`). It streams the
    // staged object → chunked JSONL and flips the dataset to `ready`.
    this.enqueueNormalize({
      projectId,
      datasetId,
      stagingKey,
      filename,
      logContext: "failed to enqueue normalize",
    });

    return { datasetId, status: "processing" };
  }

  /**
   * ADR-032 D5/M4: fire-and-forget the normalize enqueue (shared by
   * `finalizeUpload` + `retryNormalize`). NEVER block the HTTP response on
   * normalization — in prod the GroupQueue producer `.send()` is non-blocking;
   * the no-Redis memory-queue and inline modes would otherwise run the whole
   * normalize inside the request (violating ADR D5 "no synchronous-in-request"
   * for the single-node self-host shape). The client polls `processing`.
   * tenantId === projectId (datasets are project-scoped and the event-sourcing
   * tenant IS the project). `filename` drives format detection.
   *
   * Recovery: if the enqueue *rejects synchronously* (the queue producer
   * `.send()` throws), no job is in flight, so the row's `processing` is a lie —
   * flip it to `failed` (guarded on still-`processing` via `failIfProcessing`,
   * so it never clobbers the more specific error the inline handler already set
   * on its own failure) so the drawer's retry surfaces. The *lost-after-send*
   * window (send resolves, then the worker dies mid-job) is undetectable here —
   * `reapStaleProcessing` is its poll-triggered backstop.
   */
  private enqueueNormalize(args: {
    projectId: string;
    datasetId: string;
    stagingKey: string;
    filename: string;
    logContext: string;
  }): void {
    const { projectId, datasetId, stagingKey, filename, logContext } = args;
    void enqueueDatasetNormalize({
      prisma: this.prisma,
      payload: {
        id: datasetId,
        tenantId: projectId,
        projectId,
        datasetId,
        stagingKey,
        filename,
      },
    }).catch((error: unknown) => {
      logger.error({ error, datasetId }, logContext);
      void this.repository
        .failIfProcessing({
          id: datasetId,
          projectId,
          statusError: "We couldn't start processing your file. Please retry.",
        })
        .catch((flipError: unknown) => {
          logger.error(
            { error: flipError, datasetId },
            "failed to mark dataset failed after normalize enqueue error",
          );
        });
    });
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
    // M1: filename is co-set with the staging key; a present key with no
    // filename is a corrupt row. Fail loudly rather than re-driving with a
    // `.jsonl` guess that would mis-parse a CSV (see finalizeUpload).
    const filename = dataset.uploadFilename;
    if (!filename) {
      throw new DatasetNotRetryableError(
        "Dataset upload is missing its filename — cannot detect file format",
      );
    }

    await this.repository.update({
      id: datasetId,
      projectId,
      data: { status: "processing", statusError: null },
    });

    // M4: fire-and-forget — don't block the retry HTTP response on the
    // normalize (see `enqueueNormalize`). A synchronous enqueue failure flips
    // the row back to `failed` so the user can retry again.
    this.enqueueNormalize({
      projectId,
      datasetId,
      stagingKey,
      filename,
      logContext: "failed to enqueue normalize retry",
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

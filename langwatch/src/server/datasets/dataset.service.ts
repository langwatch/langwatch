import type { Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { tryToMapPreviousColumnsToNewColumns } from "~/optimization_studio/utils/datasetUtils";
import { slugify } from "~/utils/slugify";
import {
  createManyDatasetRecords,
  getFullDataset,
} from "../api/routers/datasetRecord.utils";
import { DatasetRepository } from "./dataset.repository";
import { DatasetRecordRepository } from "./dataset-record.repository";
import {
  DatasetConflictError,
  DatasetNotFoundError,
  InvalidColumnError,
} from "./errors";
import { ExperimentRepository } from "./experiment.repository";
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
   * Creates a new dataset with generated slug and optional records.
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

    const { canUseS3 } = await this.repository.getProjectWithOrgS3Settings({
      projectId,
    });

    const dataset = await this.repository.create({
      id: `dataset_${nanoid()}`,
      slug,
      name,
      projectId,
      columnTypes,
      useS3: canUseS3,
    });

    if (datasetRecords) {
      await createManyDatasetRecords({
        datasetId: dataset.id,
        projectId,
        datasetRecords,
      });
    }

    return dataset;
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
  async getBySlugOrId(params: {
    slugOrId: string;
    projectId: string;
  }) {
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
  async archiveDataset(params: {
    slugOrId: string;
    projectId: string;
  }) {
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
        entry: params.entry,
      });
      return { record: updated, created: false };
    }

    const created = await this.recordRepository.create({
      id: params.recordId,
      datasetId: dataset.id,
      projectId: params.projectId,
      entry: params.entry,
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

    const datasetColumns = dataset.columnTypes as DatasetColumns;
    const validColumnNames = new Set(datasetColumns.map((c) => c.name));

    // Validate column names across all entries
    for (const entry of params.entries) {
      for (const key of Object.keys(entry)) {
        if (!validColumnNames.has(key)) {
          throw new InvalidColumnError(key, dataset.name);
        }
      }
    }

    // Build records with missing columns filled as null and generated IDs
    const records = params.entries.map((entry) => {
      const fullEntry: Record<string, unknown> = {};
      for (const col of datasetColumns) {
        fullEntry[col.name] = entry[col.name] ?? null;
      }
      return {
        id: nanoid(),
        entry: fullEntry as Prisma.InputJsonValue,
      };
    });

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

    // Fetch source records
    const sourceRecords = await this.recordRepository.findDatasetRecords({
      datasetId: sourceDatasetId,
      projectId: sourceProjectId,
    });

    // Determine new name
    const newName = await this.findNextAvailableName(
      targetProjectId,
      sourceDataset.name,
    );

    // Create new dataset
    const newDataset = await this.createNewDataset({
      projectId: targetProjectId,
      name: newName,
      columnTypes: sourceDataset.columnTypes as DatasetColumns,
      datasetRecords: sourceRecords.map((record) => ({
        ...(record.entry as Record<string, any>),
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
        parts.push(
          `unexpected columns: ${missingColumns.join(", ")}`,
        );
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

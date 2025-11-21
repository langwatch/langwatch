import { type PrismaClient, type Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";
import type { DatasetColumns, DatasetRecordEntry } from "./types";
import { tryToMapPreviousColumnsToNewColumns } from "~/optimization_studio/utils/datasetUtils";
import { createManyDatasetRecords } from "../api/routers/datasetRecord";
import { DatasetRepository } from "./dataset.repository";
import { DatasetRecordRepository } from "./dataset-record.repository";
import { ExperimentRepository } from "./experiment.repository";
import { DatasetNotFoundError, DatasetConflictError } from "./errors";

/**
 * Service input types for business operations
 */
export type UpsertDatasetParams = {
  projectId: string;
  name?: string;
  experimentId?: string;
  columnTypes: DatasetColumns;
  datasetId?: string;
  datasetRecords?: DatasetRecordEntry[];
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
    private readonly experimentRepository: ExperimentRepository
  ) {}

  /**
   * Static factory method for creating a DatasetService with proper DI.
   */
  static create(prisma: PrismaClient): DatasetService {
    const repository = new DatasetRepository(prisma);
    const recordRepository = new DatasetRecordRepository(prisma);
    const experimentRepository = new ExperimentRepository(prisma);
    return new DatasetService(prisma, repository, recordRepository, experimentRepository);
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
    const { projectId, name, experimentId, columnTypes, datasetId, datasetRecords } = params;

    // Resolve the dataset name
    const resolvedName = name ?? await this.resolveExperimentName(projectId, experimentId);

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
        { tx }
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
        { tx }
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
          { tx }
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
        { tx }
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
    datasetRecords?: DatasetRecordEntry[];
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
    }
  ): Promise<void> {
    const { datasetId, projectId, oldColumnTypes, newColumnTypes } = params;

    const datasetRecords = await this.recordRepository.findDatasetRecords(
      {
        datasetId,
        projectId,
      },
      options
    );

    const updatedEntries = tryToMapPreviousColumnsToNewColumns(
      datasetRecords.map((record) => record.entry as DatasetRecordEntry),
      oldColumnTypes,
      newColumnTypes
    );

    if (updatedEntries.length !== datasetRecords.length) {
      throw new Error(
        `Column migration failed: expected ${datasetRecords.length} records but got ${updatedEntries.length}`
      );
    }

    await this.recordRepository.updateDatasetRecordsTransaction(
      projectId,
      datasetRecords.map((record, index) => ({
        id: record.id,
        entry: updatedEntries[index]!,
      })),
      options
    );
  }

  /**
   * Validates a dataset name by computing its slug and checking availability.
   */
  async validateDatasetName(
    params: ValidateDatasetNameParams
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
    proposedName: string
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
    experimentId?: string
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
    baseName: string
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
}


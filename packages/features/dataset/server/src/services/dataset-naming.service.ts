/**
 * Dataset name uniqueness: the slug a proposed name resolves to, whether that slug is free in
 * the project, and the next numbered variant when it is not.
 */
import {
  DatasetConflictError,
  datasetNameInputSchema,
  type DatasetNameInput,
  type DatasetNameResult,
} from "@langwatch/dataset-contract";
import { datasetSlugOf } from "../rules/dataset-selection.rules.ts";
import type { DatasetRepository } from "../repositories/dataset.repository.ts";

const MAX_NAME_CANDIDATES = 10_000;

export class DatasetNamingService {
  static create(repository: DatasetRepository): DatasetNamingService {
    return new DatasetNamingService(repository);
  }

  private constructor(private readonly repository: DatasetRepository) {}

  async validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    const parsed = datasetNameInputSchema.parse(input);
    const slug = datasetSlugOf(parsed.proposedName);
    const conflict = await this.repository.findBySlug({
      projectId: parsed.projectId,
      slug,
      excludeId: parsed.excludeDatasetId,
    });

    return {
      available: conflict === null,
      slug,
      ...(conflict ? { conflictsWith: conflict.id } : {}),
    };
  }

  async findNextAvailableName(input: DatasetNameInput): Promise<string> {
    const parsed = datasetNameInputSchema.parse(input);
    const baseName = parsed.proposedName.trim();
    if ((await this.validateDatasetName(parsed)).available) {
      return baseName;
    }

    for (let index = 2; index < MAX_NAME_CANDIDATES; index += 1) {
      const candidate = `${baseName} ${index}`;
      const check = await this.validateDatasetName({ ...parsed, proposedName: candidate });
      if (check.available) {
        return candidate;
      }
    }

    throw new DatasetConflictError("Unable to find an available dataset name");
  }
}

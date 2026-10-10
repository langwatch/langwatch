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

import type { DatasetRepository } from "../repositories/dataset.repository.ts";
import { datasetSlugOf } from "../rules/dataset-selection.rules.ts";

const MAX_NAME_CANDIDATES = 10_000;

export class DatasetNamingService {
  static create(repository: DatasetRepository): DatasetNamingService {
    return new DatasetNamingService(repository);
  }

  private constructor(private readonly repository: DatasetRepository) {}

  async validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    const parsed = datasetNameInputSchema.parse(input);
    // Editing: the dataset keeps its slug on rename, so that is the one to show.
    const edited = parsed.excludeDatasetId
      ? await this.repository.findById({ id: parsed.excludeDatasetId, projectId: parsed.projectId })
      : null;
    if (edited && edited.name === parsed.proposedName) {
      return { available: true, slug: edited.slug };
    }
    const slug = datasetSlugOf(parsed.proposedName);
    const conflict = await this.repository.findBySlug({
      projectId: parsed.projectId,
      slug,
      excludeId: parsed.excludeDatasetId,
    });

    return {
      available: conflict === null,
      slug: edited?.slug ?? slug,
      ...(conflict ? { conflictsWith: conflict.name } : {}),
    };
  }

  async findNextAvailableName(input: DatasetNameInput): Promise<string> {
    const baseName = input.proposedName.trim();
    if ((await this.validateDatasetName(input)).available) {
      return baseName;
    }

    for (let index = 2; index < MAX_NAME_CANDIDATES; index += 1) {
      const candidate = `${baseName} ${index}`;
      const check = await this.validateDatasetName({ ...input, proposedName: candidate });
      if (check.available) {
        return candidate;
      }
    }

    throw new DatasetConflictError("Unable to find an available dataset name");
  }
}

import { ProjectNotFoundError, projectSchema } from "@langwatch/project-contract";
import { nowInstant, toDate } from "@langwatch/time";

import type {
  ProjectStorageSettings,
  ProjectStorageSettingsRepository,
} from "../project-storage-settings.repository.ts";
import type { MemoryProjectDatabase } from "./memory.project.database.ts";

/** Holds the settings as given: the memory tier seals nothing. */
export class MemoryProjectStorageSettingsRepository implements ProjectStorageSettingsRepository {
  readonly #database: MemoryProjectDatabase;

  private constructor(database: MemoryProjectDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryProjectDatabase }>,
  ): MemoryProjectStorageSettingsRepository {
    return new MemoryProjectStorageSettingsRepository(input.memory);
  }

  async update({
    projectId,
    organizationId,
    settings,
  }: {
    projectId: string;
    organizationId: string;
    settings: ProjectStorageSettings;
  }): Promise<ProjectStorageSettings> {
    const project = this.#database.findProject(projectId);
    if (
      !project ||
      project.archivedAt !== null ||
      !this.#database.isInOrganization(project, organizationId)
    ) {
      throw new ProjectNotFoundError("Project not found");
    }
    const stored: ProjectStorageSettings = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined),
    );
    this.#database.putProject(
      projectSchema.parse({ ...project, ...stored, updatedAt: toDate(nowInstant()) }),
    );

    return stored;
  }
}

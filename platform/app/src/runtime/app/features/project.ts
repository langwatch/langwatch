import type { ProjectService } from "@langwatch/project-contract";
import {
  PostgresProjectAdapter,
  ProjectCredentialsAdapter,
  type PostgresProjectAdapterOptions,
} from "@langwatch/project-server";

/**
 * The options this process supplies. The project id and ingestion key are not
 * among them: both are persisted formats the feature package owns
 * (`ProjectCredentialsAdapter`), so every process that composes a
 * ProjectService mints them the same way rather than describing them again.
 */
export type AppProjectRuntimeOptions = Omit<PostgresProjectAdapterOptions, "credentials">;

/**
 * Composes the process-owned Project service for the application runtime.
 *
 * The application supplies the already-composed persistence and collaborator
 * ports; the feature adapter remains the only place that assembles the
 * private Project implementation.
 */
export class AppProjectRuntime {
  private constructor(private readonly options: AppProjectRuntimeOptions) {}

  static create(options: AppProjectRuntimeOptions): AppProjectRuntime {
    return new AppProjectRuntime(options);
  }

  build(): ProjectService {
    return PostgresProjectAdapter.create({
      ...this.options,
      credentials: ProjectCredentialsAdapter.create(),
    }).build();
  }
}

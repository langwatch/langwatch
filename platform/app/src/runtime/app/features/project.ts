import type { ProjectService } from "@langwatch/project-contract";
import {
  PostgresProjectAdapter,
  type PostgresProjectAdapterOptions,
} from "@langwatch/project-server";

/**
 * Composes the process-owned Project service for the application runtime.
 *
 * The application supplies the already-composed persistence and collaborator
 * ports; the feature adapter remains the only place that assembles the
 * private Project implementation.
 */
export class AppProjectRuntime {
  private constructor(
    private readonly options: PostgresProjectAdapterOptions,
  ) {}

  static create(options: PostgresProjectAdapterOptions): AppProjectRuntime {
    return new AppProjectRuntime(options);
  }

  build(): ProjectService {
    return PostgresProjectAdapter.create(this.options).build();
  }
}

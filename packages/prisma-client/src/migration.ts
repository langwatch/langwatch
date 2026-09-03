export interface PrismaMigrationRequest {
  databaseUrl: string;
  schemaPath: URL;
  migrationsPath: URL;
}

/**
 * Process-specific execution boundary (CLI, job runner, or control plane).
 * The package supplies canonical locations and explicit configuration; the
 * process decides how commands are launched and which environment they get.
 */
export abstract class PrismaMigrationExecutor {
  abstract deploy(request: PrismaMigrationRequest): Promise<void>;
}

export interface PrismaMigrationServiceOptions {
  executor: PrismaMigrationExecutor;
  schemaPath?: URL | undefined;
  migrationsPath?: URL | undefined;
}

export class PrismaMigrationService {
  private constructor(
    private readonly executor: PrismaMigrationExecutor,
    private readonly schemaPath: URL,
    private readonly migrationsPath: URL,
  ) {}

  static create(options: PrismaMigrationServiceOptions): PrismaMigrationService {
    return new PrismaMigrationService(
      options.executor,
      options.schemaPath ?? new URL("../prisma/schema.prisma", import.meta.url),
      options.migrationsPath ?? new URL("../prisma/migrations/", import.meta.url),
    );
  }

  deploy(input: { databaseUrl: string }): Promise<void> {
    return this.executor.deploy({
      databaseUrl: input.databaseUrl,
      schemaPath: this.schemaPath,
      migrationsPath: this.migrationsPath,
    });
  }
}

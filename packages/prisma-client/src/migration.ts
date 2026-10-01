import { readdir } from "node:fs/promises";

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

/**
 * The migration folder names this release ships, sorted: what the database's
 * ledger is compared against. Empty where the folder is not on this install.
 */
export async function listPrismaMigrationNames({
  migrationsPath = new URL("../prisma/migrations/", import.meta.url),
}: { migrationsPath?: URL } = {}): Promise<string[]> {
  try {
    const entries = await readdir(migrationsPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

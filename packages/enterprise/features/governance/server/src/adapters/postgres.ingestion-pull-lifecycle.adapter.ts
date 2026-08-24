import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import type {
  IngestionPullLifecycleCommandPort,
  IngestionPullLifecycleDatabase,
  IngestionPullTenantPort,
} from "../ports/ingestion-pull-lifecycle.port";
import { PrismaIngestionPullLifecycleRepository } from "../repositories/prisma/prisma.ingestion-pull-lifecycle.repository";
import { IngestionPullLifecycleService } from "../services/ingestion-pull-lifecycle.service";

export type PostgresIngestionPullLifecycleAdapterOptions = {
  database: IngestionPullLifecycleDatabase;
  tenant: IngestionPullTenantPort;
  commands: IngestionPullLifecycleCommandPort;
  diagnostics?: GovernanceDiagnosticsPort;
  now?: () => number;
};

/** Public composition seam; the Prisma repository remains private. */
export class PostgresIngestionPullLifecycleAdapter {
  private constructor(
    private readonly options: PostgresIngestionPullLifecycleAdapterOptions,
  ) {}

  static create(
    options: PostgresIngestionPullLifecycleAdapterOptions,
  ): PostgresIngestionPullLifecycleAdapter {
    return new PostgresIngestionPullLifecycleAdapter(options);
  }

  build(): IngestionPullLifecycleService {
    return IngestionPullLifecycleService.create({
      repository: PrismaIngestionPullLifecycleRepository.create(
        this.options.database,
      ),
      tenant: this.options.tenant,
      commands: this.options.commands,
      diagnostics: this.options.diagnostics,
      now: this.options.now,
    });
  }
}

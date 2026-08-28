import type { ProjectService } from "@langwatch/project-contract";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import type {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
} from "../ports/ingestion-source.port";
import { PrismaIngestionSourceRepository } from "../repositories/prisma/prisma.ingestion-source.repository";
import type { IngestionCredentialsService } from "../services/ingestion-credentials.service";
import type { IngestionSecretService } from "../services/ingestion-source-secret.service";
import { IngestionSourceService } from "../services/ingestion-source.service";
import type { PullDestinationService } from "../services/pull-destination.service";

/** Binds Postgres persistence to the canonical ingestion-source service. */
export class PostgresIngestionSourceAdapter {
  private constructor(
    private readonly options: {
      database: object;
      projects: ProjectService;
      entitlements: IngestionSourceEntitlementsPort;
      lifecycle: IngestionSourceLifecyclePort;
      credentials: IngestionCredentialsService;
      secrets: IngestionSecretService;
      destinations: PullDestinationService;
      diagnostics: GovernanceDiagnosticsPort;
      now?: () => number;
    },
  ) {}

  static create(options: {
    database: object;
    projects: ProjectService;
    entitlements: IngestionSourceEntitlementsPort;
    lifecycle: IngestionSourceLifecyclePort;
    credentials: IngestionCredentialsService;
    secrets: IngestionSecretService;
    destinations: PullDestinationService;
    diagnostics: GovernanceDiagnosticsPort;
    now?: () => number;
  }): PostgresIngestionSourceAdapter {
    return new PostgresIngestionSourceAdapter(options);
  }

  build(): IngestionSourceService {
    return IngestionSourceService.create({
      repository: PrismaIngestionSourceRepository.create(this.options.database),
      projects: this.options.projects,
      entitlements: this.options.entitlements,
      lifecycle: this.options.lifecycle,
      credentials: this.options.credentials,
      secrets: this.options.secrets,
      destinations: this.options.destinations,
      diagnostics: this.options.diagnostics,
      now: this.options.now,
    });
  }
}

import type { ProjectDiagnosticsPort } from "../ports/project.port";
import {
  PrismaProjectRepository,
  type PrismaProjectDatabase,
} from "../repositories/prisma/prisma.project.repository";
import { ProjectMetadataService } from "../services/project-metadata.service";

/** The models the ingestion seam needs from the client. */
export type ProjectMetadataDatabase = PrismaProjectDatabase;

/**
 * The project reads and the one project write that ingestion performs,
 * composed from one Prisma client and nothing else.
 *
 * A background process that folds spans has to read the project a tenant id
 * names, read it with its team so a privacy policy and a cost scope can be
 * resolved, stamp the first-message and integrated flags, and find the
 * organization admin to tell about a first trace. Reaching those through
 * `ProjectService` meant composing a `ProjectCredentialsPort`, an
 * `OrganizationService` — and so an authz service, a grants service and three
 * identity ports — plus the LWQL key map and an S3 stored-object deleter, none
 * of which any of those five operations asks anything. This is the seam that
 * makes them reachable on their own.
 *
 * The object it builds satisfies the narrow ports its consumers declare —
 * Trace's `TraceProjectMetadataPort`, Data Privacy's `DataPrivacyProjectPort`,
 * Model Provider's `ModelCostProjectPort` and Automation's
 * `AutomationProjectIdentityPort`. `ProjectService` satisfies all four as
 * well, because it composes this same service and delegates to it, which is
 * what keeps the application's own compositions compiling unchanged and what
 * keeps the two processes answering from one implementation rather than two.
 */
export class PostgresProjectMetadataAdapter {
  static create(options: {
    database: ProjectMetadataDatabase;
    diagnostics?: ProjectDiagnosticsPort;
  }): PostgresProjectMetadataAdapter {
    return new PostgresProjectMetadataAdapter(options.database, options.diagnostics);
  }

  private constructor(
    private readonly database: ProjectMetadataDatabase,
    private readonly diagnostics?: ProjectDiagnosticsPort,
  ) {}

  build(): ProjectMetadataService {
    return ProjectMetadataService.create({
      repository: PrismaProjectRepository.create(this.database),
      ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}),
    });
  }
}

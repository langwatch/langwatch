import type { ProjectService as ProjectServiceContract } from "@langwatch/project-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type {
  ProjectCredentialsPort,
  ProjectDiagnosticsPort,
  ProjectKeyMapPort,
  ProjectStoredObjectsPort,
} from "../ports/project.port.ts";
import { PrismaProjectRepository } from "../repositories/prisma/prisma.project.repository.ts";
import type { PrismaProjectDatabase } from "../repositories/prisma/prisma.project.repository.ts";
import { ProjectService } from "../services/project.service.ts";

export interface PostgresProjectAdapterOptions {
  /**
   * The composition root's own guarded client, typed.
   *
   * It used to arrive as a two-field structural type and be cast back to a
   * `PrismaClient` at the repository, which described the client twice and
   * checked it nowhere.
   */
  database: PrismaProjectDatabase;
  /**
   * How a new project's id and ingestion key are minted.
   *
   * This used to be two loose closures the composition root supplied, which
   * put a persisted credential format in the process rather than in the
   * feature. `ProjectCredentialsAdapter` is the implementation every process
   * should pass.
   */
  credentials: ProjectCredentialsPort;
  organizations: OrganizationApi;
  keyMap?: ProjectKeyMapPort;
  storedObjects?: ProjectStoredObjectsPort;
  diagnostics?: ProjectDiagnosticsPort;
}

export class PostgresProjectAdapter {
  private constructor(private readonly options: PostgresProjectAdapterOptions) {}

  static create(options: PostgresProjectAdapterOptions): PostgresProjectAdapter {
    return new PostgresProjectAdapter(options);
  }

  build(): ProjectServiceContract {
    return ProjectService.create({
      repository: PrismaProjectRepository.create({ prisma: this.options.database }),
      credentials: this.options.credentials,
      organizations: this.options.organizations,
      keyMap: this.options.keyMap,
      storedObjects: this.options.storedObjects,
      diagnostics: this.options.diagnostics,
    });
  }
}

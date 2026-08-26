import type { ProjectService as ProjectServiceContract } from "@langwatch/project-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  ProjectCredentialsPort,
  type ProjectDatabase,
  type ProjectDiagnosticsPort,
  type ProjectKeyMapPort,
  type ProjectStoredObjectsPort,
} from "../ports/project.port";
import { PrismaProjectRepository } from "../repositories/prisma/prisma-project.repository";
import { ProjectService } from "../services/project.service";

class FunctionProjectCredentials extends ProjectCredentialsPort {
  constructor(
    private readonly projectId: () => string,
    private readonly apiKey: () => string,
  ) {
    super();
  }

  generateProjectId(): string {
    return this.projectId();
  }

  generateApiKey(): string {
    return this.apiKey();
  }
}

export interface PostgresProjectAdapterOptions {
  database: ProjectDatabase;
  generateProjectId: () => string;
  generateApiKey: () => string;
  organizations: OrganizationService;
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
      repository: PrismaProjectRepository.create(this.options.database),
      credentials: new FunctionProjectCredentials(
        this.options.generateProjectId,
        this.options.generateApiKey,
      ),
      organizations: this.options.organizations,
      keyMap: this.options.keyMap,
      storedObjects: this.options.storedObjects,
      diagnostics: this.options.diagnostics,
    });
  }
}

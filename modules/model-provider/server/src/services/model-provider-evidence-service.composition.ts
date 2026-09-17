import type { ProcessMembers } from "@langwatch/infrastructure/members";
import type { ModelCostProject } from "../app/model-provider.members.ts";
import { PrismaModelProviderEvidenceRepository } from "../repositories/prisma/prisma.model-provider-evidence.repository.ts";
import { ModelProviderEvidenceService } from "./model-provider-evidence.service.ts";
import { ModelProviderProjectScopeService } from "./model-provider-project-scope.service.ts";

/** The one model the evidence read needs from the client. */
export type ModelProviderEvidenceDatabase = Pick<ProcessMembers["prisma"], "modelProvider">;

/**
 * The setup checklist's provider step, composed from one Prisma client and one project read.
 * Replaces a `prisma.modelProvider.findFirst` once written directly in the API's own composition,
 * which bypassed the encryption rules attached to this read
 * (`specs/model-providers/encrypt-custom-keys.feature`).
 */
export class PostgresModelProviderEvidenceAdapter {
  private constructor(
    private readonly database: ModelProviderEvidenceDatabase,
    private readonly projects: ModelCostProject,
  ) {}

  static create(options: {
    database: ModelProviderEvidenceDatabase;
    projects: ModelCostProject;
  }): PostgresModelProviderEvidenceAdapter {
    return new PostgresModelProviderEvidenceAdapter(options.database, options.projects);
  }

  build(): ModelProviderEvidenceService {
    return ModelProviderEvidenceService.create({
      providers: PrismaModelProviderEvidenceRepository.create(this.database),
      scopes: ModelProviderProjectScopeService.create({ projects: this.projects }),
    });
  }
}

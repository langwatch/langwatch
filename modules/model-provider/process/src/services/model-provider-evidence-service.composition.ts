import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { ModelCostProject } from "../app/model-provider.members.ts";
import { PrismaModelProviderEvidenceRepository } from "../repositories/prisma/prisma.model-provider-evidence.repository.ts";
import { ModelProviderEvidenceService } from "./model-provider-evidence.service.ts";
import { ModelProviderProjectScopeService } from "./model-provider-project-scope.service.ts";

/** The one model the evidence read needs from the client. */
export type ModelProviderEvidenceDatabase = Pick<ProcessMembers["prisma"], "modelProvider">;

/**
 * The setup checklist's provider step, from one Prisma client and one project read; replaces a
 * direct `prisma.modelProvider.findFirst` that bypassed the encryption rules on this read.
 * @see specs/model-providers/encrypt-custom-keys.feature
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

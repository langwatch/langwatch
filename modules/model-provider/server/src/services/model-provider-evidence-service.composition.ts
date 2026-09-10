import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelCostProjectPort } from "../ports/model-provider.port.ts";
import { PrismaModelProviderEvidenceRepository } from "../repositories/prisma/prisma.model-provider-evidence.repository.ts";
import { ModelProviderEvidenceService } from "./model-provider-evidence.service.ts";
import { ModelProviderProjectScopeService } from "./model-provider-project-scope.service.ts";

/** The one model the evidence read needs from the client. */
export type ModelProviderEvidenceDatabase = Pick<PrismaClient, "modelProvider">;

/**
 * The setup checklist's provider step, composed from one Prisma client and one
 * project read.
 *
 * The twin of {@link PostgresModelCostCatalogAdapter}, and it exists for the
 * same reason: the question is a project's own, the answer is a row that is
 * already scoped to that project's cascade, and every collaborator
 * `ModelProviderApi` would demand to answer it is there for writing
 * credentials rather than for counting them.
 *
 * What it replaces is a `prisma.modelProvider.findFirst` written in the API's
 * own composition. The lint that governs Prisma reads governs IMPORTS, not
 * call sites, so a composition that already holds the client could read this
 * table with no encryption rules attached to the read at all — which is the
 * hole `specs/model-providers/encrypt-custom-keys.feature` names.
 */
export class PostgresModelProviderEvidenceAdapter {
  private constructor(
    private readonly database: ModelProviderEvidenceDatabase,
    private readonly projects: ModelCostProjectPort,
  ) {}

  static create(options: {
    database: ModelProviderEvidenceDatabase;
    projects: ModelCostProjectPort;
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

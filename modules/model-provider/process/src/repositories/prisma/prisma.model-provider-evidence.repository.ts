import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ModelProviderEvidenceRepository } from "../model-provider-evidence.repository.ts";

type Database = Pick<PrismaClient, "modelProvider">;

/**
 * Whether any provider row is attached to one of a project's scopes and switched on. A second
 * repository over `ModelProvider`, deliberately holding no credential codec so it cannot hand a
 * credential to anybody — the shape `specs/model-providers/encrypt-custom-keys.feature` requires.
 */
export class PrismaModelProviderEvidenceRepository implements ModelProviderEvidenceRepository {
  private constructor(private readonly database: Database) {}

  static create(database: Database): PrismaModelProviderEvidenceRepository {
    return new PrismaModelProviderEvidenceRepository(database);
  }

  async hasEnabledForScopes(projectScopes: ModelDefaultScope[]): Promise<boolean> {
    // An empty scope list would leave the `some` clause matching every scope
    // row, so the answer would be "somebody, somewhere, has a provider".
    if (projectScopes.length === 0) {
      return false;
    }

    const row = await this.database.modelProvider.findFirst({
      where: {
        enabled: true,
        scopes: { some: { OR: projectScopes } },
      },
      select: { id: true },
    });

    return row !== null;
  }
}

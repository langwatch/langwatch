import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import { ModelProviderEvidenceRepository } from "../../ports/model-provider.port";

type Database = Pick<PrismaClient, "modelProvider">;

/**
 * Whether any provider row is attached to one of a project's scopes and
 * switched on.
 *
 * A second repository over the `ModelProvider` table rather than a method on
 * {@link PrismaModelProviderRepository}, and it holds no credential codec on
 * purpose: it selects an id, maps nothing, and therefore cannot hand a
 * credential — encrypted or decrypted — to anybody. That is the whole reason
 * it exists. The setup checklist used to ask this question of the API
 * process's own Prisma delegate, which is exactly the shape
 * `specs/model-providers/encrypt-custom-keys.feature` refuses: a `where` on
 * this table written outside this package is one nobody can hold to the
 * encryption rules.
 *
 * Typed at the seam — `Pick<PrismaClient, "modelProvider">` rather than the
 * `object` the older provider repository still takes — so the client a
 * composition passes is checked by the compiler rather than by a runtime `in`
 * test.
 */
export class PrismaModelProviderEvidenceRepository extends ModelProviderEvidenceRepository {
  private constructor(private readonly database: Database) {
    super();
  }

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

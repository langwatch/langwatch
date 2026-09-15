import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { ModelProviderEvidenceRepository } from "../model-provider-evidence.repository.ts";
import { matchesAnyScope, MemoryModelProviderDatabase } from "./memory.model-provider.database.ts";

/**
 * The setup checklist's provider step over the shared rows, and it decodes no
 * credential for the same reason its Postgres twin selects only an id.
 */
export class MemoryModelProviderEvidenceRepository implements ModelProviderEvidenceRepository {
  static create(
    input: Readonly<{ database: MemoryModelProviderDatabase }>,
  ): MemoryModelProviderEvidenceRepository {
    return new MemoryModelProviderEvidenceRepository(input.database);
  }

  private constructor(private readonly database: MemoryModelProviderDatabase) {}

  hasEnabledForScopes(projectScopes: ModelDefaultScope[]): Promise<boolean> {
    // An empty scope list would leave the `some` clause matching every scope
    // row, so the answer would be "somebody, somewhere, has a provider".
    if (projectScopes.length === 0) return Promise.resolve(false);

    const found = [...this.database.providers.values()].some(
      (row) => row.enabled && matchesAnyScope(row.scopes, projectScopes),
    );

    return Promise.resolve(found);
  }
}

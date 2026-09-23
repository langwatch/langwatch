import type { ApiKeyBinding } from "@langwatch/api-key-contract";
import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";

import type { ApiKeyRow, StoredApiKey } from "../repositories/api-key.repository.ts";

/**
 * A key's grants are authz's facts, read off the grants head (#7633): the
 * key row carries none of its own, so every read that answers a key joins
 * them here, per organization, in one read per organization.
 */
export class ApiKeyBindingsService {
  static create(options: {
    authz: Pick<AuthzApi, "listApiKeyBindings" | "listScopeBindings">;
  }): ApiKeyBindingsService {
    return new ApiKeyBindingsService(options.authz);
  }

  private constructor(
    private readonly authz: Pick<AuthzApi, "listApiKeyBindings" | "listScopeBindings">,
  ) {}

  async attach(rows: readonly ApiKeyRow[]): Promise<StoredApiKey[]> {
    const byOrganization = new Map<string, string[]>();
    for (const row of rows) {
      byOrganization.set(row.organizationId, [
        ...(byOrganization.get(row.organizationId) ?? []),
        row.id,
      ]);
    }
    const bindingsByKey = new Map<string, ApiKeyBinding[]>();
    for (const [organizationId, apiKeyIds] of byOrganization) {
      for (const binding of await this.authz.listApiKeyBindings({ organizationId, apiKeyIds })) {
        if (!binding.apiKeyId) continue;
        bindingsByKey.set(binding.apiKeyId, [
          ...(bindingsByKey.get(binding.apiKeyId) ?? []),
          apiKeyBindingOf(binding),
        ]);
      }
    }

    return rows.map((row) => ({ ...row, roleBindings: bindingsByKey.get(row.id) ?? [] }));
  }

  async attachOne(row: ApiKeyRow): Promise<StoredApiKey> {
    const [attached] = await this.attach([row]);

    return attached ?? { ...row, roleBindings: [] };
  }

  /** The keys granted anything on this project, read off the grants head. */
  async findKeyIdsReachingProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<string[]> {
    const bindings = await this.authz.listScopeBindings({
      organizationId: input.organizationId,
      scopeType: "PROJECT",
      scopeIds: [input.projectId],
    });

    return [
      ...new Set(bindings.flatMap((binding) => (binding.apiKeyId ? [binding.apiKeyId] : []))),
    ];
  }
}

function apiKeyBindingOf(binding: AuthzAccessBinding): ApiKeyBinding {
  return {
    id: binding.id,
    role: binding.role,
    customRoleId: binding.customRoleId,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  };
}

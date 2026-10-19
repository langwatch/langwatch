import {
  ApiKeyScopeViolationError,
  type ApiKeyScope,
  type UpdateApiKeyInput,
} from "@langwatch/api-key-contract";
import type { AuthzPrincipalRef } from "@langwatch/authz-contract";

import type { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service.ts";

type Requester = { userId?: string | null | undefined; apiKeyId?: string | null | undefined };

/** Whose holdings bound a key's bindings: its owner, else the person; and any requesting key. */
function ceilingPrincipals({
  ownerUserId,
  userId,
  apiKeyId,
}: Requester & { ownerUserId: string | null }): AuthzPrincipalRef[] {
  const person = ownerUserId ?? (apiKeyId ? null : userId);

  return [
    ...(person ? [{ type: "user" as const, id: person }] : []),
    ...(apiKeyId ? [{ type: "apiKey" as const, id: apiKeyId }] : []),
  ];
}

/**
 * The checks a key's bindings pass before any grant is written: membership, every scope,
 * personal-scope ownership and each caller's ceiling, in that order.
 */
export class ApiKeyBindingValidationService {
  static create({ grants }: { grants: ApiKeyGrantPolicyService }): ApiKeyBindingValidationService {
    return new ApiKeyBindingValidationService(grants);
  }

  private constructor(private readonly grants: ApiKeyGrantPolicyService) {}

  async validateCreate(input: {
    isSystemManaged: boolean;
    userId: string | null;
    createdByUserId: string | null;
    callerApiKeyId: string | null;
    organizationId: string;
    bindings: ApiKeyScope[];
    permissions: string[] | undefined;
  }): Promise<void> {
    if (input.userId) {
      await this.grants.ensureCallerIsOrgMember({
        userId: input.userId,
        organizationId: input.organizationId,
      });
    }

    for (const binding of input.bindings) {
      await this.grants.validateScope(binding, input.organizationId);
    }

    await this.grants.assertPersonalScopesOwnedBy({
      scopes: input.bindings,
      organizationId: input.organizationId,
      ownerUserId: input.userId,
      isSystemManaged: input.isSystemManaged,
    });
    const principals = ceilingPrincipals({
      ownerUserId: input.userId,
      userId: input.createdByUserId,
      apiKeyId: input.callerApiKeyId,
    });
    // A key's own role is bounded only here: no one to bound it by is a platform mint.
    if (input.permissions?.length && principals.length === 0 && !input.isSystemManaged) {
      throw new ApiKeyScopeViolationError(
        "A restricted key needs an owner, a creator or a requesting key to bound its permissions",
      );
    }

    for (const principal of principals) {
      await this.grants.assertCeiling({
        principal,
        organizationId: input.organizationId,
        bindings: input.bindings,
        permissions: input.permissions ?? [],
      });
    }
  }

  /** The new bindings' scopes, personal-scope ownership and every caller's ceiling, in order. */
  async validateUpdate({
    input,
    bindings,
    ownerUserId,
    permissions,
  }: {
    input: UpdateApiKeyInput;
    bindings: ApiKeyScope[];
    ownerUserId: string | null;
    permissions: string[] | undefined;
  }): Promise<void> {
    for (const binding of bindings) {
      await this.grants.validateScope(binding, input.organizationId);
    }

    await this.grants.assertPersonalScopesOwnedBy({
      scopes: bindings,
      organizationId: input.organizationId,
      ownerUserId,
      isSystemManaged: false,
    });
    const principals = ceilingPrincipals({
      ownerUserId,
      userId: input.callerUserId,
      apiKeyId: input.callerApiKeyId,
    });
    for (const principal of principals) {
      await this.grants.assertCeiling({
        principal,
        organizationId: input.organizationId,
        bindings,
        permissions: permissions ?? [],
      });
    }
  }
}

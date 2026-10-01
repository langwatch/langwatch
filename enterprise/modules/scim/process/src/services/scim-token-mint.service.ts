// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A SCIM token can push anyone into a directory group and so hand on that group's grants:
 * minting one is a grant door. The minter must hold everything an organization admin holds.
 */
import {
  GrantExceedsCallerPermissionsError,
  permissionsConferred,
  type AuthzApi,
} from "@langwatch/authz-contract";
import type { ScimTokenCaller } from "@langwatch/enterprise-scim-contract";

export class ScimTokenMintService {
  static create(authz: Pick<AuthzApi, "findPermissionsBeyondCaller">): ScimTokenMintService {
    return new ScimTokenMintService(authz);
  }

  private constructor(private readonly authz: Pick<AuthzApi, "findPermissionsBeyondCaller">) {}

  async assertMayMint({
    organizationId,
    by,
  }: {
    organizationId: string;
    by: ScimTokenCaller;
  }): Promise<void> {
    const missing = await this.authz.findPermissionsBeyondCaller({
      organizationId,
      // The key a call arrived on bounds it, never its owner (as authz.module.ts rules).
      caller: by.apiKeyId ? { type: "apiKey", id: by.apiKeyId } : { type: "user", id: by.id },
      scope: { type: "organization", id: organizationId },
      permissions: [
        ...permissionsConferred({
          role: "ADMIN",
          scopeType: "ORGANIZATION",
          customPermissions: [],
        }),
      ],
    });
    if (missing.length > 0) throw new GrantExceedsCallerPermissionsError(missing);
  }
}

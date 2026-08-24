// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { NotFoundError } from "@langwatch/handled-error";

/**
 * The SCIM token id does not exist in the caller's organization, or was
 * already revoked, which reads identically on purpose: a revoke is
 * idempotent for a provisioning tool either way.
 */
export class ScimTokenNotFoundError extends NotFoundError {
  declare readonly code: "scim_token_not_found";

  constructor(tokenId: string) {
    super("scim_token_not_found", "SCIM token", tokenId, {
      meta: { tokenId },
    });
    this.name = "ScimTokenNotFoundError";
  }
}

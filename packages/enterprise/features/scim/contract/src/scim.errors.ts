// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { NotFoundError } from "@langwatch/handled-error";
import type { ScimError } from "./scim.contract";

/** A SCIM protocol failure; transports render its stable SCIM Error resource. */
export class ScimProtocolError extends Error {
  constructor(readonly response: ScimError) {
    super(response.detail);
    this.name = "ScimProtocolError";
  }
}

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

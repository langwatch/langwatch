// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Handled errors for directory sync (ADR-045).
 *
 * Every refusal here is one the caller can act on, which is the whole test
 * for a HandledError: a token minted without a connection is a request to
 * fix, and a push aimed outside the token's connection is a configuration
 * mistake in the identity provider. What a customer READS comes from the
 * presentation registry keyed by `code`
 * (src/features/errors/logic/presentation.ts); the `message` here is the
 * customer-safe sentence the REST boundary ships, and it names no
 * environment variable, no hostname and no internal service.
 *
 * See specs/identity/scim-connection-sync.feature.
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

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
      ...remediation("scim_token_not_found"),
    });
    this.name = "ScimTokenNotFoundError";
  }
}

/**
 * A directory token was minted without naming the connection it is for.
 *
 * The connection IS the token's write authority, so a token without one has
 * no bounded authority to be issued with — which is exactly the thing D08
 * exists to stop. Refused rather than defaulted: picking a connection on the
 * caller's behalf would hand out authority nobody asked for.
 */
export class ScimConnectionRequiredError extends HandledError {
  declare readonly code: "scim_connection_required";

  constructor() {
    super(
      "scim_connection_required",
      "A directory token has to name the single sign-on connection it is for",
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "ScimConnectionRequiredError";
  }
}

/**
 * The named connection is not one this organization has.
 *
 * A connection belonging to somebody else reads exactly like one that does
 * not exist, and the meta carries only the id the caller already sent: the
 * refusal must not confirm that another organization's connection is real.
 */
export class ScimConnectionNotFoundError extends NotFoundError {
  declare readonly code: "scim_connection_not_found";

  constructor(connectionId: string) {
    super(
      "scim_connection_not_found",
      "Single sign-on connection",
      connectionId,
      {
        meta: { connectionId },
      },
    );
    this.name = "ScimConnectionNotFoundError";
  }
}

/**
 * A push tried to change somebody who belongs to a different connection.
 *
 * This is the isolation story in one refusal: a contractor directory and a
 * staff directory can share an organization precisely because neither one's
 * token reaches the other's people. `fault` is the customer's — the identity
 * provider is configured against the wrong connection, and that is theirs to
 * correct — and 403 rather than 404 because the person exists and telling the
 * provider to retry would be a lie.
 */
export class ScimWriteOutsideConnectionError extends HandledError {
  declare readonly code: "scim_write_outside_connection";

  constructor(meta: { userId?: string } = {}) {
    super(
      "scim_write_outside_connection",
      "This directory token cannot change people provisioned by another connection",
      { httpStatus: 403, fault: "customer", meta },
    );
    this.name = "ScimWriteOutsideConnectionError";
  }
}

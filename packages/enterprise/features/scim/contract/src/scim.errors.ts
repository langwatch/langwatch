// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError, NotFoundError } from "@langwatch/handled-error";
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

export class ScimConnectionNotFoundError extends NotFoundError {
  declare readonly code: "scim_connection_not_found";

  constructor(connectionId: string) {
    super("scim_connection_not_found", "Single sign-on connection", connectionId, {
      meta: { connectionId },
    });
    this.name = "ScimConnectionNotFoundError";
  }
}

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

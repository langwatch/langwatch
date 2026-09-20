// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError, NotFoundError } from "@langwatch/handled-error";

import type { ScimError } from "./scim.contract.ts";

/**
 * A SCIM protocol refusal, at the status the protocol names: a missing bearer,
 * a filter the door will not answer, a resource the connection does not own.
 * Handled, so the framework boundary answers that status — a plain Error left
 * every one of them reading as an unattributed 500.
 */
export class ScimProtocolError extends HandledError {
  declare readonly code: "scim_protocol_refusal";

  constructor(readonly response: ScimError) {
    const httpStatus = Number(response.status);
    super("scim_protocol_refusal", response.detail, {
      httpStatus: Number.isInteger(httpStatus) ? httpStatus : 400,
      fault: httpStatus >= 500 ? "platform" : "customer",
      meta: { scimStatus: response.status },
    });
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

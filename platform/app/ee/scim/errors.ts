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
 * A token the administrator chose, and it is too short to be one.
 *
 * The only way a supplied value is worse than a minted one is by being short
 * or guessable, and this is the only place that can say so — the identity
 * provider's console will accept anything. The length is on the error so the
 * copy can name it rather than the reader guessing what "too short" means.
 */
export class ScimTokenTooShortError extends HandledError {
  declare readonly code: "scim_token_too_short";

  constructor(minimum: number) {
    super(
      "scim_token_too_short",
      `A directory token you choose yourself has to be at least ${minimum} characters`,
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "ScimTokenTooShortError";
  }
}

/**
 * A token value that cannot be used, because somebody already stores it.
 *
 * The message says nothing about who. Confirming that a value is taken tells
 * one customer that another customer holds it, which turns an error message
 * into a probe — so it is written as advice, not as a finding. The unique
 * constraint on the column refuses the same thing independently; this is the
 * sentence a person reads, not the thing standing in the way.
 */
export class ScimTokenUnavailableError extends HandledError {
  declare readonly code: "scim_token_unavailable";

  constructor() {
    super(
      "scim_token_unavailable",
      "That token value cannot be used. Choose a different one, or let LangWatch generate it",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "ScimTokenUnavailableError";
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
/**
 * A re-drive named an apply that is not retired (ADR-122).
 *
 * The operator surface's one write is guarded on exactly this: an apply the
 * identity provider is still retrying will be attempted again on its own
 * schedule, and sending it through by hand would mean two things pushing the
 * same state. 409 rather than 404 because the failure exists and the caller
 * is not wrong about it — it is simply not finished yet.
 *
 * A second re-drive of the SAME dead letter reads the same way, which is the
 * honest answer: the operation has already been sent through, and the
 * history says so.
 */
export class ScimApplyNotRetiredError extends HandledError {
  declare readonly code: "scim_apply_not_retired";

  constructor(meta: { connectionId?: string } = {}) {
    super(
      "scim_apply_not_retired",
      "Only a directory operation that has stopped being retried can be sent through again",
      { httpStatus: 409, fault: "customer", meta },
    );
    this.name = "ScimApplyNotRetiredError";
  }
}

/**
 * The retired apply is one this history cannot reconstruct.
 *
 * A directory-sync fact carries ids and a reason code and nothing else — the
 * D01 payload rule — so a failed ADDITION or group mapping has no payload
 * left to send through again. A removal does: it is fully described by the
 * person and the organization, both of which the dead letter names. So
 * removals re-drive and nothing else does, and the remediation for the rest
 * is the same one the customer is given: the directory's next push.
 */
export class ScimApplyNotRedrivableError extends HandledError {
  declare readonly code: "scim_apply_not_redrivable";

  constructor(meta: { op?: string } = {}) {
    super(
      "scim_apply_not_redrivable",
      "Only a removal can be sent through again; anything the directory adds is re-asserted by its next push",
      { httpStatus: 422, fault: "customer", meta },
    );
    this.name = "ScimApplyNotRedrivableError";
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

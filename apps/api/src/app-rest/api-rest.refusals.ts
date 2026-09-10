/**
 * What a door answers a credential it will not accept.
 *
 * One class per code, because the code is what a caller branches on. The
 * sentences are the ones this surface has always published: an SDK's own error
 * copy quotes them, so they are part of the wire and not decoration.
 */
import { HandledError } from "@langwatch/handled-error";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The sentence an unauthenticated caller of a project family receives. It
 * names all three accepted credential shapes because that is what it has
 * always named.
 */
export const MISSING_PROJECT_CREDENTIAL_MESSAGE =
  "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";

export const INVALID_PROJECT_CREDENTIAL_MESSAGE = "Invalid auth token.";

/** No credential at all reached an organization door. */
export class ApiOrganizationMissingCredentialsError extends HandledError {
  declare readonly code: "missing_credentials";

  constructor() {
    super("missing_credentials", "Authentication required. Use Authorization: Bearer <api-key>.", {
      httpStatus: 401,
      fault: "customer",
    });
  }
}

/** A PROJECT key was presented at an organization door: a different mistake. */
export class ApiOrganizationCredentialClassMismatchError extends HandledError {
  declare readonly code: "credential_class_mismatch";

  constructor() {
    super(
      "credential_class_mismatch",
      "This endpoint requires an organization API key, and a project key was presented.",
      { httpStatus: 401, fault: "customer" },
    );
  }
}

/** The token reached the door and stands for nothing this deployment knows. */
export class ApiOrganizationInvalidCredentialsError extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", "Invalid credentials.", { httpStatus: 401, fault: "customer" });
  }
}

/**
 * The credential resolved, and the tenant behind it is gone. Answered as a 401
 * rather than a 404: which organizations exist is not something an unaccepted
 * credential gets to learn.
 */
export class ApiOrganizationNotFoundForCredentialError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 401,
      fault: "customer",
    });
  }
}

/** The lookup behind the door broke. The caller learns nothing of the cause. */
export class ApiOrganizationAuthenticationUnavailableError extends HandledError {
  declare readonly code: "internal_error";

  constructor() {
    super("internal_error", "Authentication service error", {
      httpStatus: 500,
      fault: "platform",
    });
  }
}

/** The credential is accepted and does not hold what the route asked for. */
export class ApiOrganizationPermissionError extends HandledError {
  constructor(permission: AuthzPermission) {
    super("insufficient_permissions", `Insufficient permissions. Required: ${permission}`, {
      httpStatus: 403,
      fault: "customer",
    });
  }
}

/**
 * A door this deployment opened with no verifier behind it. It fails CLOSED:
 * every request is refused, and the refusal names what the deployment did not
 * compose rather than letting an unverified caller through.
 */
export class ApiRestDoorUnverifiedError extends HandledError {
  constructor(door: string) {
    super("unauthorized", "Authentication required", {
      httpStatus: 401,
      fault: "customer",
      meta: { door },
    });
  }
}

/**
 * A credential the door would not accept, carrying the status and the body the
 * credential chain itself wrote. ONE class for every family: the refusal is the
 * DOOR's answer, and a family rendering its own would be a copy of it.
 */
export class ApiRestCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("REST request refused at the door");
    this.name = "ApiRestCredentialRefusal";
  }
}

/**
 * A door whose secret this deployment did not configure. 404 rather than 401:
 * whether this deployment holds a given secret is not something a caller
 * presenting the wrong one gets to learn.
 */
export class ApiRestDoorUnconfiguredError extends HandledError {
  constructor(door: string) {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer", meta: { door } });
  }
}

import { HandledError } from "@langwatch/handled-error";

export class OrganizationNotFoundError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor(organizationId?: string) {
    super("organization_not_found", "Organization not found", {
      ...(organizationId ? { meta: { organizationId } } : {}),
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "OrganizationNotFoundError";
  }
}

/**
 * A capability this deployment did not compose, refused by name rather than
 * answered emptily — an empty invitation list reads as "nobody invited",
 * which an administrator acts on by inviting the same person twice.
 */
export class OrganizationCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
      // The capability itself, because the wire message is the CODE: without
      // it a customer's failure is traceable to "something is off" rather than
      // to the deployment shape that caused it.
      meta: { capability },
    });
    this.name = "OrganizationCapabilityUnavailableError";
  }
}

export class OrganizationHasNoTeamError extends Error {
  readonly code = "organization_has_no_team" as const;

  constructor(organizationId: string) {
    super(`Organization ${organizationId} has no team.`);
    this.name = "OrganizationHasNoTeamError";
  }
}

/**
 * The session carries no address, so there is nothing for an invitation to be
 * matched against. Named rather than degraded: signing in again with the
 * invited account is the one thing that fixes it.
 */
export class SignedInAddressRequiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "You must be signed in to accept the invite", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "SignedInAddressRequiredError";
  }
}

/**
 * A team-role update the caller could not have meant: it names a different
 * member, or a team outside the organization whose seats are being changed.
 */
export class TeamRoleUpdateRejectedError extends HandledError {
  declare readonly code: "validation_error";

  constructor(message: string, meta: Readonly<Record<string, unknown>>) {
    super("validation_error", message, { httpStatus: 400, fault: "customer", meta });
    this.name = "TeamRoleUpdateRejectedError";
  }
}

/**
 * The organization was created and its first project was not. Handled because
 * the customer can act on it - the project screen creates one directly - and
 * because an unnamed 500 here reads as "sign-up is broken" when it is not.
 */
export class OnboardingProjectNotCreatedError extends HandledError {
  declare readonly code: "project_creation_failed";

  constructor() {
    super(
      "project_creation_failed",
      "The organization was created, but its first project was not",
      {
        httpStatus: 500,
        fault: "platform",
      },
    );
    this.name = "OnboardingProjectNotCreatedError";
  }
}

/**
 * The caller may not read this audit trail through the project they
 * filtered it by. Separate from the organization-tier refusal, same code,
 * so the customer reads one sentence either way.
 */
export class AuditTrailDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to read this audit trail", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "AuditTrailDeniedError";
  }
}

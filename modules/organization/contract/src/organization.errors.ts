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
 * answered emptily. An empty invitation list tells an administrator nobody has
 * been invited, which is the one answer they act on by inviting the same
 * person twice.
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

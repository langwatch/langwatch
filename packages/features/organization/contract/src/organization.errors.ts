import { HandledError } from "@langwatch/handled-error";

export class OrganizationNotFoundError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationHasNoTeamError extends Error {
  readonly code = "organization_has_no_team" as const;

  constructor(organizationId: string) {
    super(`Organization ${organizationId} has no team.`);
    this.name = "OrganizationHasNoTeamError";
  }
}

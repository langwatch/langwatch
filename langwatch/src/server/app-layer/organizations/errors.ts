import { NotFoundError } from "@langwatch/handled-error";

export class OrganizationNotFoundForTeamError extends NotFoundError {
  declare readonly code: "organization_not_found_for_team";

  constructor(teamId: string, options: { reasons?: readonly Error[] } = {}) {
    super("organization_not_found_for_team", "Organization for team", teamId, {
      meta: { teamId },
      ...options,
    });
    this.name = "OrganizationNotFoundForTeamError";
  }
}

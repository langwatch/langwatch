import { NotFoundError } from "../domain-error";

export class OrganizationNotFoundForTeamError extends NotFoundError {
  declare readonly kind: "organization_not_found_for_team";

  constructor(teamId: string, options: { reasons?: readonly Error[] } = {}) {
    super("organization_not_found_for_team", "Organization for team", teamId, {
      meta: { teamId },
      ...options,
    });
    this.name = "OrganizationNotFoundForTeamError";
  }
}

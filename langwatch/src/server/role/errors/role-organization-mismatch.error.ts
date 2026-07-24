export class RoleOrganizationMismatchError extends Error {
  constructor(message = "Custom role does not belong to team's organization") {
    super(message);
    this.name = "RoleOrganizationMismatchError";
  }
}

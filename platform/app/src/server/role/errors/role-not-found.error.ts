export class RoleNotFoundError extends Error {
  constructor(message = "Role not found") {
    super(message);
    this.name = "RoleNotFoundError";
  }
}

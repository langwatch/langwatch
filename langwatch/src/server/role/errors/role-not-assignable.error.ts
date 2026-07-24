export class RoleNotAssignableError extends Error {
  constructor(message = "Role is not assignable") {
    super(message);
    this.name = "RoleNotAssignableError";
  }
}

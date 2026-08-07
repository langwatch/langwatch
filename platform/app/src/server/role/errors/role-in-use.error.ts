export class RoleInUseError extends Error {
  constructor(
    public readonly userCount: number,
    public readonly bindingCount: number = 0,
    message = bindingCount > 0
      ? `Cannot delete role that is in use by ${userCount} user assignment(s) and ${bindingCount} role binding(s)`
      : `Cannot delete role that is assigned to ${userCount} user(s)`,
  ) {
    super(message);
    this.name = "RoleInUseError";
  }
}

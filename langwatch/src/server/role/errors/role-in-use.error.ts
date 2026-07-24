export class RoleInUseError extends Error {
  constructor(
    public readonly userCount: number,
    message = `Cannot delete role that is assigned to ${userCount} user(s)`,
  ) {
    super(message);
    this.name = "RoleInUseError";
  }
}

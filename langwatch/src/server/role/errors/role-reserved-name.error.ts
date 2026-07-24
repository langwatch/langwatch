export class RoleReservedNameError extends Error {
  constructor(message = "Role names starting with 'apikey:' are reserved for system use") {
    super(message);
    this.name = "RoleReservedNameError";
  }
}

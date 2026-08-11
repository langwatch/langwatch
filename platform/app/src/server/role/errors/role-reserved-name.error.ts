import { HandledError } from "@langwatch/handled-error";

/**
 * The requested role name is in the namespace LangWatch mints system roles
 * under (API key system roles are named `apikey:<id>`). Handled (422): the
 * name is the caller's to change, and nothing else about the request is
 * wrong.
 */
export class RoleReservedNameError extends HandledError {
  declare readonly code: "custom_role_name_reserved";

  constructor(
    message = "Role names starting with 'apikey:' are reserved for system use",
  ) {
    super("custom_role_name_reserved", message, { httpStatus: 422 });
    this.name = "RoleReservedNameError";
  }
}

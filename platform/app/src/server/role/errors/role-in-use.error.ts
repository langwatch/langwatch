import { HandledError } from "@langwatch/handled-error";

import { remediation } from "../../app-layer/error-remediation";

/**
 * The role still has holders (legacy team-user assignments, role bindings,
 * or both), so deleting it would leave those grants dangling (a dangling
 * customRoleId silently falls back to the built-in permission bag, which is a
 * privilege change nobody asked for).
 *
 * Handled (409): the counts ride in `meta` so a caller can see exactly what
 * is holding the role. The public fields stay for same-process callers that
 * already read them.
 */
export class RoleInUseError extends HandledError {
  declare readonly code: "custom_role_in_use";

  constructor(
    public readonly userCount: number,
    public readonly bindingCount: number = 0,
    message = bindingCount > 0
      ? `Cannot delete role that is in use by ${userCount} user assignment(s) and ${bindingCount} role binding(s)`
      : `Cannot delete role that is assigned to ${userCount} user(s)`,
  ) {
    super("custom_role_in_use", message, {
      httpStatus: 409,
      meta: { userCount, bindingCount },
      ...remediation("custom_role_in_use"),
    });
    this.name = "RoleInUseError";
  }
}

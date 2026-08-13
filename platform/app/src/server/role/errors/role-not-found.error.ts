import { NotFoundError } from "@langwatch/handled-error";

/**
 * The custom role does not exist, is not a user-created role (API key system
 * roles are not addressable here), or belongs to another organization. All
 * three read the same on purpose: confirming which foreign role ids exist is
 * not this error's job.
 */
export class RoleNotFoundError extends NotFoundError {
  declare readonly code: "custom_role_not_found";

  constructor(roleId: string) {
    super("custom_role_not_found", "Custom role", roleId, {
      meta: { roleId },
    });
    this.name = "RoleNotFoundError";
  }
}

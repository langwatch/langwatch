import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

export class RoleDuplicateNameError extends HandledError {
  declare readonly code: "custom_role_name_taken";
  constructor(message = "A role with this name already exists") {
    super("custom_role_name_taken", message, {
      httpStatus: 409,
      ...remediation("custom_role_name_taken"),
    });
    this.name = "RoleDuplicateNameError";
  }
}

export class RoleInUseError extends HandledError {
  declare readonly code: "custom_role_in_use";
  readonly userCount: number;
  readonly bindingCount: number;
  constructor({ userCount, bindingCount = 0 }: { userCount: number; bindingCount?: number }) {
    super(
      "custom_role_in_use",
      `Cannot delete role that is in use by ${userCount} user assignment(s) and ${bindingCount} role binding(s)`,
      {
        httpStatus: 409,
        meta: { userCount, bindingCount },
        ...remediation("custom_role_in_use"),
      },
    );
    this.userCount = userCount;
    this.bindingCount = bindingCount;
    this.name = "RoleInUseError";
  }
}

export class RoleNotFoundError extends NotFoundError {
  declare readonly code: "custom_role_not_found";
  constructor(roleId: string) {
    super("custom_role_not_found", "Custom role", roleId, { meta: { roleId } });
    this.name = "RoleNotFoundError";
  }
}

export class RoleReservedNameError extends HandledError {
  declare readonly code: "custom_role_name_reserved";
  constructor(message = "Role names starting with 'apikey:' are reserved for system use") {
    super("custom_role_name_reserved", message, { httpStatus: 422 });
    this.name = "RoleReservedNameError";
  }
}

/**
 * The role belongs to another organization than the team it was offered to, so
 * it cannot be assigned there. The customer reads the same sentence as for a
 * role their organization simply may not hand out.
 */
export class RoleNotAssignableError extends HandledError {
  declare readonly code: "custom_role_not_assignable";
  constructor(message = "That role cannot be assigned here") {
    super("custom_role_not_assignable", message, { httpStatus: 422 });
    this.name = "RoleNotAssignableError";
  }
}

/** The team an assignment names does not exist. */
export class RoleTeamNotFoundError extends NotFoundError {
  declare readonly code: "team_not_found";
  constructor(teamId: string) {
    super("team_not_found", "Team", teamId, { meta: { teamId } });
    this.name = "RoleTeamNotFoundError";
  }
}

/** The person is not on the team the role was offered to. */
export class RoleUserNotTeamMemberError extends HandledError {
  declare readonly code: "team_membership_not_found";
  constructor(message = "That person is not a member of this team") {
    super("team_membership_not_found", message, { httpStatus: 404 });
    this.name = "RoleUserNotTeamMemberError";
  }
}

/** An organization-exclusive permission was bound at TEAM or PROJECT scope. */
export class OrgExclusivePermissionScopeError extends HandledError {
  declare readonly code: "org_exclusive_permission_scope";
  constructor(permission: string, scopeType: string) {
    super(
      "org_exclusive_permission_scope",
      "That permission only takes effect at organization scope",
      { httpStatus: 422, meta: { permission, scopeType } },
    );
    this.name = "OrgExclusivePermissionScopeError";
  }
}

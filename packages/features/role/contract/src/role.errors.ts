import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class RoleDuplicateNameError extends HandledError {
  declare readonly code: "custom_role_name_taken";
  constructor(message = "A role with this name already exists") {
    super("custom_role_name_taken", message, { httpStatus: 409 });
    this.name = "RoleDuplicateNameError";
  }
}

export class RoleInUseError extends HandledError {
  declare readonly code: "custom_role_in_use";
  readonly userCount: number;
  readonly bindingCount: number;
  constructor({
    userCount,
    bindingCount = 0,
  }: {
    userCount: number;
    bindingCount?: number;
  }) {
    super(
      "custom_role_in_use",
      `Cannot delete role that is in use by ${userCount} user assignment(s) and ${bindingCount} role binding(s)`,
      {
        httpStatus: 409,
        meta: { userCount, bindingCount },
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
  constructor(
    message = "Role names starting with 'apikey:' are reserved for system use",
  ) {
    super("custom_role_name_reserved", message, { httpStatus: 422 });
    this.name = "RoleReservedNameError";
  }
}

export class RoleNotAssignableError extends Error {
  name = "RoleNotAssignableError" as const;
}
export class RoleOrganizationMismatchError extends Error {
  name = "RoleOrganizationMismatchError" as const;
}
export class TeamNotFoundError extends Error {
  name = "TeamNotFoundError" as const;
}
export class UserNotTeamMemberError extends Error {
  name = "UserNotTeamMemberError" as const;
}

export class OrgExclusivePermissionScopeError extends Error {
  name = "OrgExclusivePermissionScopeError" as const;
  readonly permission: string;
  readonly scopeType: string;
  constructor(permission: string, scopeType: string) {
    super(`${permission} can only be granted at organization scope`);
    this.permission = permission;
    this.scopeType = scopeType;
  }
}

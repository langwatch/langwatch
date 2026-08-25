import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class GroupNotFoundError extends NotFoundError {
  declare readonly code: "group_not_found";

  constructor(groupId?: string) {
    super(
      "group_not_found",
      "Group",
      groupId ?? "",
      groupId ? { meta: { groupId } } : {},
    );
    this.name = "GroupNotFoundError";
  }
}

export class ScimManagedGroupError extends HandledError {
  declare readonly code: "scim_managed_group";

  constructor(groupId?: string) {
    super(
      "scim_managed_group",
      "This group is managed by your identity provider, so it is renamed, changed and removed there",
      { httpStatus: 409, ...(groupId ? { meta: { groupId } } : {}) },
    );
    this.name = "ScimManagedGroupError";
  }
}

export class GroupBindingNotFoundError extends NotFoundError {
  declare readonly code: "role_binding_not_found";

  constructor(bindingId?: string) {
    super(
      "role_binding_not_found",
      "Role binding",
      bindingId ?? "",
      bindingId ? { meta: { bindingId } } : {},
    );
    this.name = "GroupBindingNotFoundError";
  }
}

export class GroupMemberAlreadyAddedError extends HandledError {
  declare readonly code: "group_member_already_added";

  constructor(userId?: string) {
    super("group_member_already_added", "That member is already in this group", {
      httpStatus: 409,
      ...(userId ? { meta: { userId } } : {}),
    });
    this.name = "GroupMemberAlreadyAddedError";
  }
}

export class GroupMembershipNotFoundError extends NotFoundError {
  declare readonly code: "group_membership_not_found";

  constructor(userId?: string) {
    super(
      "group_membership_not_found",
      "Group membership",
      userId ?? "",
      userId ? { meta: { userId } } : {},
    );
    this.name = "GroupMembershipNotFoundError";
  }
}

export class GroupScopeNotInOrganizationError extends HandledError {
  declare readonly code: "scope_not_in_organization";

  constructor(scopeType?: string) {
    super(
      "scope_not_in_organization",
      "That scope does not belong to this organization",
      { httpStatus: 422, ...(scopeType ? { meta: { scopeType } } : {}) },
    );
    this.name = "GroupScopeNotInOrganizationError";
  }
}

export class GroupCustomRoleRequiredError extends HandledError {
  declare readonly code: "custom_role_id_required";

  constructor() {
    super(
      "custom_role_id_required",
      "A CUSTOM binding has to name which custom role it grants",
      { httpStatus: 422 },
    );
    this.name = "GroupCustomRoleRequiredError";
  }
}

export class GroupRoleNotAssignableError extends HandledError {
  declare readonly code: "custom_role_not_assignable";

  constructor(customRoleId?: string) {
    super("custom_role_not_assignable", "That custom role cannot be granted here", {
      httpStatus: 422,
      ...(customRoleId ? { meta: { customRoleId } } : {}),
    });
    this.name = "GroupRoleNotAssignableError";
  }
}

export class GroupRoleScopeError extends HandledError {
  declare readonly code: "org_exclusive_permission_scope";

  constructor(permission: string, scopeType: string) {
    super(
      "org_exclusive_permission_scope",
      "That permission only takes effect at organization scope",
      { httpStatus: 422, meta: { permission, scopeType } },
    );
    this.name = "GroupRoleScopeError";
  }
}

export class GroupBindingAlreadyExistsError extends HandledError {
  declare readonly code: "role_binding_already_exists";

  constructor() {
    super("role_binding_already_exists", "That role binding already exists", {
      httpStatus: 409,
    });
    this.name = "GroupBindingAlreadyExistsError";
  }
}

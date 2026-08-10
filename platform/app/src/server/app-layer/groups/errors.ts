/**
 * Handled errors for the groups domain (ADR-045).
 *
 * Every refusal this family can name carries a stable `code`, because that is
 * the only part of an error a caller may branch on: the message is copy, and
 * it changes. They used to be plain `Error`s that the route mapped onto
 * generic HTTP classes, which published the prose in the code's place, so
 * `code` read "A CUSTOM binding requires a customRoleId". Nothing was
 * published against that: the family answered 404 in production until it was
 * mounted.
 *
 * Codes are shared with the sibling management families wherever the failure
 * is the same one (`scope_not_in_organization`, `custom_role_id_required`,
 * `user_not_in_organization`, `role_binding_not_found`), so a provisioning
 * tool handles one vocabulary across the whole surface.
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class GroupNotFoundError extends NotFoundError {
  declare readonly code: "group_not_found";

  constructor(groupId?: string) {
    super("group_not_found", "Group", groupId ?? "", {
      ...(groupId ? { meta: { groupId } } : {}),
    });
    this.name = "GroupNotFoundError";
  }
}

/**
 * The group is provisioned by an identity provider over SCIM, so its name and
 * its membership are that directory's to change. Editing it here would be
 * undone on the next sync, silently.
 */
export class ScimManagedGroupError extends HandledError {
  declare readonly code: "scim_managed_group";

  constructor(groupId?: string) {
    super(
      "scim_managed_group",
      "This group is managed by your identity provider, so its name and members are changed there",
      { httpStatus: 409, ...(groupId ? { meta: { groupId } } : {}) },
    );
    this.name = "ScimManagedGroupError";
  }
}

export class UserNotInOrganizationError extends HandledError {
  declare readonly code: "user_not_in_organization";

  constructor(userId?: string) {
    super(
      "user_not_in_organization",
      "That user is not a member of this organization",
      { httpStatus: 422, ...(userId ? { meta: { userId } } : {}) },
    );
    this.name = "GroupUserNotInOrganizationError";
  }
}

export class BindingNotFoundError extends NotFoundError {
  declare readonly code: "role_binding_not_found";

  constructor(bindingId?: string) {
    super("role_binding_not_found", "Role binding", bindingId ?? "", {
      ...(bindingId ? { meta: { bindingId } } : {}),
    });
    this.name = "GroupBindingNotFoundError";
  }
}

/** The user is already in the group, so adding them again would change nothing. */
export class DuplicateMemberError extends HandledError {
  declare readonly code: "group_member_already_added";

  constructor(userId?: string) {
    super(
      "group_member_already_added",
      "That member is already in this group",
      { httpStatus: 409, ...(userId ? { meta: { userId } } : {}) },
    );
    this.name = "DuplicateMemberError";
  }
}

export class ScopeNotInOrganizationError extends HandledError {
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

export class CustomRoleRequiredError extends HandledError {
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

/**
 * The named custom role cannot be granted here: it belongs to another
 * organization, or it is an API key's private role, which is never assignable
 * to a person or a group.
 */
export class GroupRoleNotAssignableError extends HandledError {
  declare readonly code: "custom_role_not_assignable";

  constructor(customRoleId?: string) {
    super(
      "custom_role_not_assignable",
      "That custom role cannot be granted here",
      { httpStatus: 422, ...(customRoleId ? { meta: { customRoleId } } : {}) },
    );
    this.name = "GroupRoleNotAssignableError";
  }
}

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
import { remediation } from "../error-remediation";

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
 * The group was already deleted, so there is nothing left to take away.
 *
 * Not a `GroupNotFoundError`: a deleted group is still a row, kept on purpose
 * so the memberships it held survive with it, and telling the caller it does
 * not exist would contradict the record they can read — the same distinction
 * `MemberNotInGroupError` draws for a membership that already ended. What is
 * absent is a group that still grants.
 */
export class GroupAlreadyDeletedError extends HandledError {
  declare readonly code: "group_already_deleted";

  constructor(groupId?: string) {
    super("group_already_deleted", "This group has already been deleted", {
      httpStatus: 409,
      ...remediation("group_already_deleted"),
      ...(groupId ? { meta: { groupId } } : {}),
    });
    this.name = "GroupAlreadyDeletedError";
  }
}

/**
 * The group is provisioned by an identity provider over SCIM, so its name, its
 * membership and its existence are that directory's to change. Editing it here
 * would be undone on the next sync, silently, and deleting it would take every
 * grant it carries with it until the directory pushed it back.
 */
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

/**
 * The user holds no LIVE membership of this group, so there is nothing to end.
 *
 * Not a `NotFoundError`: a membership that already ended is still a row, kept
 * on purpose, and telling the caller it does not exist would contradict the
 * record they can read. What is absent is a membership that still grants.
 *
 * This used to be a raw Prisma `P2025` escaping the repository as an unknown
 * error - the caller was told "unknown error" for a refusal we could name and
 * they could act on.
 */
export class MemberNotInGroupError extends HandledError {
  declare readonly code: "group_member_not_in_group";

  constructor(userId?: string) {
    super("group_member_not_in_group", "That member is not in this group", {
      httpStatus: 409,
      ...remediation("group_member_not_in_group"),
      ...(userId ? { meta: { userId } } : {}),
    });
    this.name = "MemberNotInGroupError";
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

/**
 * Handled errors for the role-binding domain (ADR-045).
 *
 * These are the failures the role-binding write path can name and the caller
 * can act on: a principal that is not in the organization, a scope that is
 * not either, a CUSTOM role used without an id or with one that cannot be
 * assigned, an organization-exclusive permission bound below organization
 * scope, and the two lifecycle answers (already exists / not found). Statuses
 * follow the family contract: 404 for lookups, 409 for conflicts, 422 for a
 * request that is well-formed but refers to things it cannot.
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";

import { remediation } from "../app-layer/error-remediation";

export class RoleBindingNotFoundError extends NotFoundError {
  declare readonly code: "role_binding_not_found";

  constructor(bindingId: string) {
    super("role_binding_not_found", "Role binding", bindingId, {
      meta: { bindingId },
    });
    this.name = "RoleBindingNotFoundError";
  }
}

/**
 * An identical binding (same principal, role, and scope) already exists.
 *
 * Deterministic 409 on the natural key, so a provisioning tool can treat the
 * conflict as "already done" instead of parsing a database error. The write
 * path maps Prisma's P2002 on the partial unique indexes to this.
 *
 * `meta` names the colliding scope on the single-write path only. A batch
 * write goes through `createMany`, which reports the violation without saying
 * which row caused it, so batch callers get the conflict without the scope;
 * those endpoints are all-or-nothing anyway, so there is no per-item decision
 * for the scope to inform.
 */
export class RoleBindingAlreadyExistsError extends HandledError {
  declare readonly code: "role_binding_already_exists";

  constructor(options: { meta?: Record<string, unknown> } = {}) {
    super("role_binding_already_exists", "An identical role binding already exists", {
      httpStatus: 409,
      ...remediation("role_binding_already_exists"),
      ...(options.meta ? { meta: options.meta } : {}),
    });
    this.name = "RoleBindingAlreadyExistsError";
  }
}

/**
 * The request named zero principals, or more than one. A binding grants to
 * exactly one of a user, a group, or an API key.
 */
export class RoleBindingPrincipalInvalidError extends HandledError {
  declare readonly code: "role_binding_principal_invalid";

  constructor() {
    super(
      "role_binding_principal_invalid",
      "A role binding needs exactly one principal: a user, a group, or an API key",
      { httpStatus: 422 },
    );
    this.name = "RoleBindingPrincipalInvalidError";
  }
}

export class UserNotInOrganizationError extends HandledError {
  declare readonly code: "user_not_in_organization";

  constructor(userId: string) {
    super("user_not_in_organization", "That user is not a member of this organization", {
      httpStatus: 422,
      meta: { userId },
    });
    this.name = "UserNotInOrganizationError";
  }
}

export class GroupNotInOrganizationError extends HandledError {
  declare readonly code: "group_not_in_organization";

  constructor(groupId: string) {
    super(
      "group_not_in_organization",
      "That group does not belong to this organization",
      { httpStatus: 422, meta: { groupId } },
    );
    this.name = "GroupNotInOrganizationError";
  }
}

/**
 * The named API key is not one of this organization's.
 *
 * 422 like its two sibling principals rather than 404: the key is a field in
 * the request, not the resource the request addresses, and the addressed
 * resource here is the binding collection. Says nothing about whether the id
 * exists in some other organization.
 */
export class ApiKeyNotInOrganizationError extends HandledError {
  declare readonly code: "api_key_not_in_organization";

  constructor(apiKeyId: string) {
    super(
      "api_key_not_in_organization",
      "That API key does not belong to this organization",
      { httpStatus: 422, meta: { apiKeyId } },
    );
    this.name = "ApiKeyNotInOrganizationError";
  }
}

/**
 * The named scope (team or project) is not in the caller's organization.
 * Says the KIND of scope, never confirms the id exists elsewhere.
 */
export class ScopeNotInOrganizationError extends HandledError {
  declare readonly code: "scope_not_in_organization";

  constructor(scopeType: string) {
    super(
      "scope_not_in_organization",
      "That scope does not belong to this organization",
      { httpStatus: 422, meta: { scopeType } },
    );
    this.name = "ScopeNotInOrganizationError";
  }
}

/** `role: CUSTOM` was sent without the custom role id that gives it meaning. */
export class CustomRoleIdRequiredError extends HandledError {
  declare readonly code: "custom_role_id_required";

  constructor() {
    super("custom_role_id_required", "A CUSTOM role binding needs a customRoleId", {
      httpStatus: 422,
    });
    this.name = "CustomRoleIdRequiredError";
  }
}

/**
 * The custom role cannot be assigned here: it belongs to another
 * organization, or it is an API key's system role, which only that key's own
 * binding may carry. Both read the same on purpose: the caller's fix is the
 * same, and confirming which foreign role ids exist is not this error's job.
 */
export class CustomRoleNotAssignableError extends HandledError {
  declare readonly code: "custom_role_not_assignable";

  constructor(customRoleId: string) {
    super("custom_role_not_assignable", "That custom role cannot be assigned here", {
      httpStatus: 422,
      meta: { customRoleId },
    });
    this.name = "CustomRoleNotAssignableError";
  }
}

/**
 * An organization-exclusive permission was bound at TEAM or PROJECT scope.
 *
 * Refused at write time: the resolver never grants these below organization
 * scope, so accepting the binding would store a grant that silently does
 * nothing, which is worse than a refusal: the admin believes it took effect.
 */
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

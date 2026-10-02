import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";
import { z } from "zod";

export const AUTHZ_PROBLEM_CODES = [
  "validation_error",
  "permission_denied",
  "lite_member_restricted",
  "project_permission_denied",
  "grant_validation_failed",
  "role_binding_already_exists",
  "role_binding_not_found",
  "role_binding_principal_invalid",
  "user_not_in_organization",
  "group_not_in_organization",
  "api_key_not_in_organization",
  "scope_not_in_organization",
  "custom_role_id_required",
  "custom_role_not_assignable",
  "org_exclusive_permission_scope",
  "personal_workspace_not_managed_here",
  "lite_member_viewer_only",
  "offboard_incomplete",
  "authz_ledger_unavailable",
] as const;
export const authzProblemCodeSchema = z.enum(AUTHZ_PROBLEM_CODES);
export type AuthzProblemCode = z.infer<typeof authzProblemCodeSchema>;

export const authzProblemSchema = z
  .object({
    code: authzProblemCodeSchema,
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    httpStatus: z.number().int().min(400).max(599).optional(),
    traceId: z.string().optional(),
  })
  .strict();
export type AuthzProblem = z.infer<typeof authzProblemSchema>;

export class GrantValidationError extends HandledError {
  declare readonly code: "grant_validation_failed";

  constructor(message: string, meta: Record<string, unknown> = {}) {
    super("grant_validation_failed", message, { httpStatus: 400, meta });
    this.name = "GrantValidationError";
  }
}

export class DuplicateGrantError extends HandledError {
  declare readonly code: "role_binding_already_exists";

  constructor(meta: Record<string, unknown> = {}) {
    super("role_binding_already_exists", "An identical role binding already exists", {
      httpStatus: 409,
      meta,
      ...remediation("role_binding_already_exists"),
    });
    this.name = "DuplicateGrantError";
  }
}

/** A grant asked to end at a moment already passed: 422, like the family's other input refusals. */
export class GrantExpiryInPastError extends HandledError {
  declare readonly code: "grant_expiry_in_past";

  constructor(meta: Record<string, unknown> = {}) {
    super("grant_expiry_in_past", "A grant's expiry must be in the future", {
      httpStatus: 422,
      meta,
      ...remediation("grant_expiry_in_past"),
    });
    this.name = "GrantExpiryInPastError";
  }
}

export class RoleBindingNotFoundError extends NotFoundError {
  declare readonly code: "role_binding_not_found";

  constructor(bindingId: string) {
    super(
      "role_binding_not_found",
      { resource: "Role binding", id: bindingId },
      {
        meta: { bindingId },
      },
    );
    this.name = "RoleBindingNotFoundError";
  }
}

/** A project, team or organization id that names no live scope. */
export class AuthzScopeNotFoundError extends NotFoundError {
  declare readonly code: "authz_scope_not_found";

  constructor(ids: { projectId?: string; teamId?: string; organizationId?: string }) {
    super("authz_scope_not_found", {
      resource: "Scope",
      id: ids.projectId ?? ids.teamId ?? ids.organizationId ?? "",
    });
    this.name = "AuthzScopeNotFoundError";
  }
}

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

export class GroupNotInOrganizationError extends HandledError {
  declare readonly code: "group_not_in_organization";

  constructor(groupId: string) {
    super("group_not_in_organization", "That group does not belong to this organization", {
      httpStatus: 422,
      meta: { groupId },
    });
    this.name = "GroupNotInOrganizationError";
  }
}

export class ApiKeyNotInOrganizationError extends HandledError {
  declare readonly code: "api_key_not_in_organization";

  constructor(apiKeyId: string) {
    super("api_key_not_in_organization", "That API key does not belong to this organization", {
      httpStatus: 422,
      meta: { apiKeyId },
    });
    this.name = "ApiKeyNotInOrganizationError";
  }
}

export class ScopeNotInOrganizationError extends HandledError {
  declare readonly code: "scope_not_in_organization";

  constructor(scopeType: string) {
    super("scope_not_in_organization", "That scope does not belong to this organization", {
      httpStatus: 422,
      meta: { scopeType },
    });
    this.name = "ScopeNotInOrganizationError";
  }
}

export class CustomRoleIdRequiredError extends HandledError {
  declare readonly code: "custom_role_id_required";

  constructor() {
    super("custom_role_id_required", "A CUSTOM role binding needs a customRoleId", {
      httpStatus: 422,
    });
    this.name = "CustomRoleIdRequiredError";
  }
}

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

export class AuthzPersonalWorkspaceNotManagedHereError extends HandledError {
  declare readonly code: "personal_workspace_not_managed_here";

  constructor(ownerName?: string | null) {
    super(
      "personal_workspace_not_managed_here",
      "Personal workspace teams have exactly one member: their owner. Create a shared team to collaborate with others.",
      {
        meta: ownerName ? { ownerName } : {},
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "AuthzPersonalWorkspaceNotManagedHereError";
  }
}

export class AuthzLiteMemberViewerOnlyError extends HandledError {
  declare readonly code: "lite_member_viewer_only";

  constructor(scopeName?: string | null) {
    super("lite_member_viewer_only", "A Lite Member seat allows the Viewer team role only.", {
      meta: scopeName ? { teamName: scopeName } : {},
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "AuthzLiteMemberViewerOnlyError";
  }
}

/** Storage signal lifted by AuthzGrantsService into DuplicateGrantError. */
export class DuplicateBindingError extends Error {
  readonly code = "role_binding_already_exists" as const;

  constructor() {
    super("role binding already exists at this scope");
    this.name = "DuplicateBindingError";
  }
}

/** Storage signal for a binding that disappeared between read and write. */
export class BindingMissingError extends Error {
  readonly code = "role_binding_not_found" as const;

  constructor() {
    super("role binding no longer exists");
    this.name = "BindingMissingError";
  }
}

export class OffboardIncompleteError extends HandledError {
  declare readonly code: "offboard_incomplete";

  constructor(meta: Record<string, unknown> = {}) {
    super(
      "offboard_incomplete",
      "This member still resolves permissions, so nothing was changed. Try removing them again.",
      { httpStatus: 500, fault: "platform", meta },
    );
    this.name = "OffboardIncompleteError";
  }
}

export class AuthzLedgerUnavailableError extends HandledError {
  declare readonly code: "authz_ledger_unavailable";

  constructor() {
    super(
      "authz_ledger_unavailable",
      "Access changes are temporarily unavailable. Try again in a moment.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "AuthzLedgerUnavailableError";
  }
}

/**
 * The grant append is durable, but the projection did not make the rows
 * readable in time, and the caller asked to be told (`requireProjection`) -
 * e.g. minting an API key. `fault: "platform"` — a lagging fold is ours.
 */
export class AuthzGrantNotConfirmedError extends HandledError {
  declare readonly code: "authz_grant_not_confirmed";

  constructor() {
    super(
      "authz_grant_not_confirmed",
      "We could not confirm the access change in time. Nothing was granted. Try again in a moment.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "AuthzGrantNotConfirmedError";
  }
}

export class AuthzRoleDuplicateNameError extends HandledError {
  declare readonly code: "custom_role_name_taken";

  constructor(message = "A role with this name already exists") {
    super("custom_role_name_taken", message, {
      httpStatus: 409,
      ...remediation("custom_role_name_taken"),
    });
    this.name = "AuthzRoleDuplicateNameError";
  }
}

// ── `/api/grants`: the successor family's own codes, `<resource>_<condition>` ──

export class GrantNotFoundError extends NotFoundError {
  declare readonly code: "grant_not_found";

  constructor(grantId: string) {
    super("grant_not_found", { resource: "Grant", id: grantId }, { meta: { grantId } });
    this.name = "GrantNotFoundError";
  }
}

/** The principal is not in the organization; one code for users, groups and API keys. */
export class GrantPrincipalNotFoundError extends HandledError {
  declare readonly code: "grant_principal_not_found";

  constructor(meta: { principalType: string; principalId: string }) {
    super("grant_principal_not_found", "The principal is not in this organization", {
      httpStatus: 422,
      meta,
    });
    this.name = "GrantPrincipalNotFoundError";
  }
}

export class GrantRoleNotFoundError extends HandledError {
  declare readonly code: "grant_role_not_found";

  constructor(roleId: string) {
    super("grant_role_not_found", "The role does not exist in this organization", {
      httpStatus: 422,
      meta: { roleId },
    });
    this.name = "GrantRoleNotFoundError";
  }
}

export class GrantScopeNotFoundError extends HandledError {
  declare readonly code: "grant_scope_not_found";

  constructor(meta: { scopeType: string; scopeId: string }) {
    super("grant_scope_not_found", "The scope is not in this organization", {
      httpStatus: 422,
      meta,
    });
    this.name = "GrantScopeNotFoundError";
  }
}

/** The role carries a permission that only takes effect at organization scope. */
export class GrantScopeNotAllowedError extends HandledError {
  declare readonly code: "grant_scope_not_allowed";

  constructor(meta: { permission: string; scopeType: string }) {
    super("grant_scope_not_allowed", "That role can only be granted on the organization", {
      httpStatus: 422,
      meta,
    });
    this.name = "GrantScopeNotAllowedError";
  }
}

export class GrantScopePersonalWorkspaceError extends HandledError {
  declare readonly code: "grant_scope_personal_workspace";

  constructor(meta: { scopeId: string }) {
    super(
      "grant_scope_personal_workspace",
      "A personal workspace has exactly one member, its owner",
      { httpStatus: 403, meta },
    );
    this.name = "GrantScopePersonalWorkspaceError";
  }
}

/** The organization already holds as many grants as it may. */
export class GrantLimitReachedError extends HandledError {
  declare readonly code: "grant_limit_reached";

  constructor(limit: number) {
    super("grant_limit_reached", `Maximum of ${limit} grants per organization reached`, {
      httpStatus: 409,
      meta: { limit },
    });
    this.name = "GrantLimitReachedError";
  }
}

/** Nobody grants more than they hold at that scope: names what the caller lacks. */
export class GrantExceedsCallerPermissionsError extends HandledError {
  declare readonly code: "grant_exceeds_caller_permissions";

  constructor(missingPermissions: readonly string[]) {
    super(
      "grant_exceeds_caller_permissions",
      "You cannot grant a role with permissions you do not hold yourself",
      { httpStatus: 403, meta: { missingPermissions: [...missingPermissions] } },
    );
    this.name = "GrantExceedsCallerPermissionsError";
  }
}

/** Nobody grants the platform-operator role to themselves, on any deployment. */
export class PlatformOperatorSelfGrantError extends HandledError {
  declare readonly code: "platform_operator_self_grant";

  constructor(meta: { userId: string }) {
    super("platform_operator_self_grant", "You cannot make yourself a platform operator", {
      httpStatus: 403,
      meta,
    });
    this.name = "PlatformOperatorSelfGrantError";
  }
}

/** Revoking this grant would leave the installation with no platform operator. */
export class PlatformOperatorLastHolderError extends HandledError {
  declare readonly code: "platform_operator_last_holder";

  constructor(meta: { grantId: string; userId: string }) {
    super(
      "platform_operator_last_holder",
      "The last platform operator cannot be revoked; grant the role to someone else first",
      { httpStatus: 409, meta },
    );
    this.name = "PlatformOperatorLastHolderError";
  }
}

/** A platform permission (`ops:*`) belongs to the platform-operator grant, never a custom role. */
export class PlatformPermissionNotAssignableError extends HandledError {
  declare readonly code: "platform_permission_not_assignable";

  constructor(meta: { permissions: readonly string[] }) {
    super(
      "platform_permission_not_assignable",
      "Platform permissions are held only through the platform-operator grant",
      { httpStatus: 422, meta: { permissions: [...meta.permissions] } },
    );
    this.name = "PlatformPermissionNotAssignableError";
  }
}

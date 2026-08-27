import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";
import type { AuthzDenialReason, AuthzScopeRef } from "./authz";

export const AUTHZ_PROBLEM_CODES = [
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

/**
 * ADR-092 §2 — the one denial error. `denialReason` replaces the legacy
 * pattern of smuggling `organizationRole` out of permission checks so error
 * mappers could special-case lite members.
 */
export class PermissionDeniedError extends HandledError {
  constructor({
    permission,
    scope,
    denialReason,
  }: {
    permission: string;
    /**
     * The tier and id the check was refused at — a structural subset of
     * `AuthzScopeRef`, so a resolved scope ref passes straight in. Callers
     * that only know the tier (a Hono route holding a project id) do not have
     * to invent the lineage a full scope ref carries.
     */
    scope: {
      type: AuthzScopeRef["type"];
      id: string;
    };
    denialReason: AuthzDenialReason;
  }) {
    super(
      "permission_denied",
      denialReason === "lite-member-restricted"
        ? "This feature is not available for your account"
        : `You do not have permission to access this ${scope.type}`,
      {
        httpStatus: 403,
        meta: {
          permission,
          scopeType: scope.type,
          denialReason,
        },
      },
    );
    this.name = "PermissionDeniedError";
  }

  get denialReason(): AuthzDenialReason {
    return this.meta.denialReason as AuthzDenialReason;
  }
}

export class LiteMemberRestrictedError extends HandledError {
  declare readonly code: "lite_member_restricted";

  constructor(resource: string) {
    super("lite_member_restricted", "This feature is not available for your account", {
      meta: { resource },
      httpStatus: 401,
    });
    this.name = "LiteMemberRestrictedError";
  }
}

export class ProjectPermissionDeniedError extends HandledError {
  declare readonly code: "project_permission_denied";

  constructor(permission: string) {
    super("project_permission_denied", "You do not have permission to do this on this project", {
      meta: { permission },
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ProjectPermissionDeniedError";
  }
}

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
    });
    this.name = "DuplicateGrantError";
  }
}

export class RoleBindingNotFoundError extends NotFoundError {
  declare readonly code: "role_binding_not_found";

  constructor(bindingId: string) {
    super("role_binding_not_found", "Role binding", bindingId, {
      meta: { bindingId },
    });
    this.name = "RoleBindingNotFoundError";
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

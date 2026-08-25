import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";
import type { AuthzDenialReason, AuthzScopeRef } from "./authz";

export const AUTHZ_PROBLEM_CODES = [
  "permission_denied",
  "lite_member_restricted",
  "project_permission_denied",
  "grant_validation_failed",
  "role_binding_already_exists",
  "role_binding_not_found",
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
    super(
      "lite_member_restricted",
      "This feature is not available for your account",
      { meta: { resource }, httpStatus: 401 },
    );
    this.name = "LiteMemberRestrictedError";
  }
}

export class ProjectPermissionDeniedError extends HandledError {
  declare readonly code: "project_permission_denied";

  constructor(permission: string) {
    super(
      "project_permission_denied",
      "You do not have permission to do this on this project",
      {
        meta: { permission },
        httpStatus: 403,
        fault: "customer",
      },
    );
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
    super(
      "role_binding_already_exists",
      "An identical role binding already exists",
      { httpStatus: 409, meta },
    );
    this.name = "DuplicateGrantError";
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

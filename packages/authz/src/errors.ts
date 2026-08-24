import { HandledError } from "@langwatch/handled-error";
import type { AuthzDenialReason, AuthzScopeRef } from "./types";

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
        : denialReason === "membership-disabled"
          ? "Your access to this organization has been disabled"
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

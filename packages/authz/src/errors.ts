import { HandledError } from "@langwatch/handled-error";
import type { AuthzDenialReason, AuthzScopeRef } from "./engine";

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
    scope: AuthzScopeRef;
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

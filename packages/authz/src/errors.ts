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

/**
 * The request named its scope field and left it empty, so there is nothing to
 * check a permission against.
 *
 * This is the answer a `.min(1)` on the input schema would have given, raised
 * from the one seam every declaration passes through so no procedure can miss
 * it. It is deliberately NOT a denial: refusing an empty id as "you may not
 * touch this" would tell a caller their own blank string is a scope someone
 * else owns. It is equally not a wiring bug — the caller can fix it by naming
 * a scope, which is exactly what makes it handled.
 *
 * `fieldErrors` is the shape the client's form mapper and the `validation_error`
 * presentation entry already read, so the copy a customer sees needs no new
 * registry entry. Scope ids are wire identifiers the customer never sees, so
 * that copy stays generic on purpose.
 */
export class BlankScopeIdError extends HandledError {
  constructor({ field }: { field: string }) {
    super("validation_error", "The request did not name a scope to act in.", {
      httpStatus: 400,
      fault: "customer",
      meta: { fieldErrors: { [field]: ["Required"] } },
    });
    this.name = "BlankScopeIdError";
  }
}

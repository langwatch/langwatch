/**
 * The access refusals: what a caller sees when a declared permission, a lite
 * membership or a disabled membership stops them. Authz raises most of them;
 * the framework raises the same classes, so there is one of each.
 */
import { HandledError } from "@langwatch/handled-error";

import type { AuthzDenialReason } from "./decision.ts";
import type { ScopeTier } from "./scope-tiers.ts";

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
     * The tier and id the check was refused at — a structural subset of authz's scope ref, so a
     * resolved scope ref passes straight in. Callers that only know the tier (a Hono route
     * holding a project id) do not have to invent the lineage a full scope ref carries.
     */
    scope: {
      type: Exclude<ScopeTier, "platform">;
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

/** A named scope field had no usable id, so the client can correct its input. */
export class BlankScopeIdError extends HandledError {
  declare readonly code: "validation_error";

  constructor({ field }: { field: string }) {
    super("validation_error", "The request did not name a scope to act in.", {
      httpStatus: 400,
      fault: "customer",
      meta: { fieldErrors: { [field]: ["Required"] } },
    });
    this.name = "BlankScopeIdError";
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

/**
 * The membership itself is switched off, so nothing in the organization is
 * reachable — distinct from a permission the caller merely lacks.
 */
export class MembershipDisabledError extends HandledError {
  declare readonly code: "membership_disabled";

  constructor() {
    super("membership_disabled", "Your access to this organization has been disabled", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "MembershipDisabledError";
  }
}

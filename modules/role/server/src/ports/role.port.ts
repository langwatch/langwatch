import type { RoleBindingScopeType } from "@langwatch/role-contract";

/**
 * The personal-workspace fence a role binding is refused at. A personal team
 * holds exactly one member, its owner, so nothing may be bound into it.
 */
export abstract class RoleScopePort {
  abstract assertNoPersonalTeamScope(input: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
  }): Promise<void>;
}

/**
 * Whether the organization's plan carries custom roles. A port rather than a
 * peer, because the sentence, the status and the tier that answer it live in
 * the commercial packages, which this one may not name.
 */
export abstract class RoleCustomRolePlanPort {
  /** Throws when the organization's plan may not define or assign a custom role. */
  abstract assertCustomRolesAllowed(input: { organizationId: string }): Promise<void>;
}

/**
 * The identifier a newly attached binding is written under. A persisted format
 * owned by the ledger, so the process that composes the ledger supplies it
 * rather than this package restating the prefix.
 */
export abstract class RoleBindingIdPort {
  abstract newBindingId(): string;
}

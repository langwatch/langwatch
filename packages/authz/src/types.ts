/**
 * ADR-092 §2 — the vocabulary the resolver speaks: who is asking, where, what
 * they hold, and what came back. Types only, so every other module in the
 * package (and the app's collector) can name them without importing the walk.
 */
import type { ShareableResourceKind } from "./registry";
import type {
  CallerKind,
  PrincipalKind,
  StoredBindingScopeTier,
} from "./vocabulary";

/**
 * Mirror Prisma's enums as plain string unions so this package stays
 * Prisma-free. The app-side collector assigns the generated enum values into
 * these directly; a new enum member added in the schema surfaces as a type
 * error at that seam, never silently here.
 */
export type TeamUserRole = "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";

/** The stored spelling of the tiers a binding may sit at. Derived from the
 *  vocabulary so it cannot drift from the event stream's or the table's. */
export type RoleBindingScopeType = StoredBindingScopeTier;

export type AuthzScopeRef =
  | { type: "project"; id: string; teamId: string; organizationId: string }
  | { type: "team"; id: string; organizationId: string }
  | { type: "organization"; id: string }
  /**
   * ADR-092 §8 — the resource tier. One shareable resource under its
   * project; `parents` lists shareable ancestors (a trace inside a shared
   * thread), most specific first. Children (spans, logs, metrics…) never
   * appear here — a child read authorizes AT its parent resource's node,
   * which is how one grant covers them all.
   */
  | {
      type: "resource";
      kind: ShareableResourceKind;
      id: string;
      parents?: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
      /**
       * Share-link tokens the request presented (ADR-057). Possession is the
       * gate: the collector only surfaces token-backed grants when their
       * token was presented, so a share row alone never authorizes and
       * trace-id guessing stays closed.
       */
      shareTokens?: readonly string[];
      projectId: string;
      teamId: string;
      organizationId: string;
    };

/**
 * Who is asking. `anonymous` is a caller with no session at all, resolvable
 * only by grants with the `anyone` audience (and the demo project), so it
 * alone carries no id.
 */
export type AuthzPrincipalRef = {
  [K in CallerKind]: K extends "anonymous" ? { type: K } : { type: K; id: string };
}[CallerKind];

/**
 * ADR-092 §8 — who a resource grant is for. Principals as everywhere, plus
 * membership sets (no enumeration — matched against the caller's collected
 * grants) and `anyone`, which is the public share expressed as a row.
 */
export type GrantAudience = {
  [K in PrincipalKind]: K extends "anyone" ? { kind: K } : { kind: K; id: string };
}[PrincipalKind];

/** A grant at the resource tier. Matched on (kind, id, projectId) — the
 *  project anchor prevents cross-project resource-id collisions. */
export type ResourceGrant = {
  kind: ShareableResourceKind;
  id: string;
  projectId: string;
  permission: string;
  audience: GrantAudience;
};

export type CollectedBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  /** Present when the binding arrived via a group membership. */
  viaGroupId?: string | null;
};

export type LegacyTeamMembership = {
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  isPersonal: boolean;
};

/**
 * Everything the engine needs to answer any question about one principal in
 * one organization. Produced by collector.ts (or the stage-F cache).
 */
export type CollectedGrants = {
  principal: AuthzPrincipalRef;
  organizationId: string;
  /** Null for api-key principals and for users with no OrganizationUser row. */
  organizationRole: "ADMIN" | "MEMBER" | "EXTERNAL" | null;
  /** True when an OrganizationUser row exists for a user principal. */
  isOrgMember: boolean;
  bindings: CollectedBinding[];
  /**
   * LEGACY-QUIRK(B): TeamUser rows, consulted only when `bindings` is empty
   * (users migrated before role bindings existed). Deleted in stage B.
   */
  legacyTeamMemberships: LegacyTeamMembership[];
  /** Custom-role permission lists, prefetched for every referenced id. */
  customRolePermissions: ReadonlyMap<string, readonly string[]>;
};

export type AuthzDenialReason =
  | "no-membership"
  | "no-binding"
  | "lite-member-restricted"
  | "owner-ceiling";

export type AuthzGrantVia =
  | "binding"
  | "org-role-floor"
  | "demo-project"
  | "legacy-team-fallback"
  | "resource-grant";

export type AuthzDecision = {
  allowed: boolean;
  permission: string;
  scope: AuthzScopeRef;
  principal: AuthzPrincipalRef;
  via?: AuthzGrantVia;
  matchedBinding?: CollectedBinding;
  denialReason?: AuthzDenialReason;
  /** ADR-092 §8 — serialisers redact on this. */
  audience: "member" | "public";
};

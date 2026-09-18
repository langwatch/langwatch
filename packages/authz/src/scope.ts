/**
 * ADR-092 §2 — where a question is asked, and who a resource grant reaches.
 * Pure geometry over a scope reference: the binding scopes that can answer at
 * it, the organization it belongs to, and whether an audience covers the
 * caller. No walk logic lives here.
 */
import type {
  AuthzScopeRef,
  CollectedGrants,
  GrantAudience,
  RoleBindingScopeType,
} from "./types";

/** One link of a scope chain: a binding scope that can grant at the scope. */
export type ScopeChainLink = {
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

/** The organization a scope belongs to, whatever its tier. */
export function scopeOrganizationId(scope: AuthzScopeRef): string {
  return scope.type === "organization" ? scope.id : scope.organizationId;
}

/** The binding scopes that can grant at `scope`, most specific first. */
export function scopeChain(scope: AuthzScopeRef): ScopeChainLink[] {
  switch (scope.type) {
    case "project":
      return [
        { scopeType: "PROJECT", scopeId: scope.id },
        { scopeType: "TEAM", scopeId: scope.teamId },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
    case "team":
      return [
        { scopeType: "TEAM", scopeId: scope.id },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
    case "organization":
      return [{ scopeType: "ORGANIZATION", scopeId: scope.id }];
    case "resource":
      // Bindings can grant at any ancestor of the resource's project; the
      // resource links themselves are matched against ResourceGrants, not
      // RoleBindings (see the resource-grant step in walk.ts).
      return [
        { scopeType: "PROJECT", scopeId: scope.projectId },
        { scopeType: "TEAM", scopeId: scope.teamId },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
  }
}

/**
 * A membership audience is a set the principal has to be IN, and a user
 * holding no active OrganizationUser row is in none of this organization's
 * sets, whatever bindings outlived them. It is the rule
 * `principalLacksMembership` applies to the binding steps of the walk,
 * repeated here because the resource tier is the one step that runs for a
 * non-member: without it, a removed member's leftover TEAM binding would
 * still answer "members of this project".
 *
 * Api-key principals hold no membership by design and pass; what they reach
 * is decided entirely by their own bindings below.
 */
function principalIsInOrganization(grants: CollectedGrants): boolean {
  return grants.principal.type !== "user" || grants.isOrgMember;
}

/**
 * The binding scopes a membership audience is REACHABLE from, most specific
 * first — the same chain `scopeChain` walks for an ordinary binding. That is
 * what makes "members of project chatbot" mean everyone who can reach the
 * project: through a binding on it, on the team that owns it, or on the
 * organization above it, exactly as an in-app read of that project resolves.
 *
 * Null when the audience names a scope this resource's lineage does not
 * contain. The engine is pure — the only project/team/organization lineage
 * it can see is the one the collector already read off storage and put on
 * the scope — so an audience naming some OTHER project is one it cannot
 * place, and an audience that cannot be placed matches nobody.
 */
function audienceScopeChain({
  audience,
  scope,
}: {
  audience: Extract<
    GrantAudience,
    { kind: "organization" | "team" | "project" }
  >;
  scope: Extract<AuthzScopeRef, { type: "resource" }>;
}): ScopeChainLink[] | null {
  switch (audience.kind) {
    case "project":
      return audience.id === scope.projectId
        ? scopeChain({
            type: "project",
            id: scope.projectId,
            teamId: scope.teamId,
            organizationId: scope.organizationId,
          })
        : null;
    case "team":
      return audience.id === scope.teamId
        ? scopeChain({
            type: "team",
            id: scope.teamId,
            organizationId: scope.organizationId,
          })
        : null;
    case "organization":
      return audience.id === scope.organizationId
        ? scopeChain({ type: "organization", id: scope.organizationId })
        : null;
  }
}

/**
 * ADR-092 §8 — does a resource grant's audience include this caller?
 *
 * A membership audience names an AUDIENCE, not a binding scope: "members of
 * project chatbot" is a REACHABILITY question, answered against the caller's
 * collected grants rather than by enumerating members. It matches when the
 * principal holds a binding (or a legacy TeamUser row) anywhere on the
 * audience's scope chain — the same chain an ordinary permission check walks
 * — so the TEAM binding that is how project membership actually arrives
 * matches "members of this project", and an organization audience matches
 * every member of the organization through the floor legacy applied at
 * organization scope.
 *
 * Everything it cannot place fails CLOSED: a user with no live membership, a
 * snapshot collected for a different organization than the resource sits in,
 * and an audience naming a scope outside the resource's own lineage all
 * match nobody.
 *
 * One v1 proxy is left, and it is the group audience: a group is visible
 * only through the bindings it derives, so a group granting nothing anywhere
 * is an audience nobody is in.
 */
export function audienceMatches({
  audience,
  grants,
  scope,
}: {
  audience: GrantAudience;
  grants: CollectedGrants;
  /**
   * The resource the grant was matched at. It carries the stored lineage a
   * membership audience is resolved against — the collector read it off the
   * project row, never off the request.
   */
  scope: Extract<AuthzScopeRef, { type: "resource" }>;
}): boolean {
  switch (audience.kind) {
    case "anyone":
      return true;
    case "user":
      return (
        grants.principal.type === "user" && grants.principal.id === audience.id
      );
    case "apiKey":
      return (
        grants.principal.type === "apiKey" &&
        grants.principal.id === audience.id
      );
    case "group":
      return (
        principalIsInOrganization(grants) &&
        grants.bindings.some((binding) => binding.viaGroupId === audience.id)
      );
    case "organization":
    case "team":
    case "project": {
      if (!principalIsInOrganization(grants)) return false;
      // The snapshot is collected per organization; one taken elsewhere
      // cannot answer for this resource's lineage.
      if (grants.organizationId !== scope.organizationId) return false;
      const chain = audienceScopeChain({ audience, scope });
      if (!chain) return false;
      // LEGACY-QUIRK(C): every member of an organization is in its audience
      // regardless of bindings — the personal-context floor, which is what
      // an organization-visibility link has always meant.
      if (audience.kind === "organization" && grants.isOrgMember) return true;
      const onChain = ({
        scopeType,
        scopeId,
      }: {
        scopeType: RoleBindingScopeType;
        scopeId: string;
      }): boolean =>
        chain.some(
          (link) => link.scopeType === scopeType && link.scopeId === scopeId,
        );
      return (
        grants.bindings.some(onChain) ||
        // LEGACY-QUIRK(B): users migrated before role bindings existed reach
        // their team — and so everything under it — through TeamUser alone.
        grants.legacyTeamMemberships.some((row) =>
          onChain({ scopeType: "TEAM", scopeId: row.teamId }),
        )
      );
    }
  }
}

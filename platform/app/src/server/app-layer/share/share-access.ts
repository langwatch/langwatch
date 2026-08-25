/**
 * ADR-092 §8 / ADR-057 — who decides that a presented share token authorizes.
 *
 * The resource tier was built (Grant rows at RESOURCE scope, `resourceGrantStep`,
 * `matchResourceGrant`, `collectResourceGrants`) and had no production caller:
 * the live share path hand-rolled the same rules next to it. This module is the
 * seam that ends that. `ShareService` presents the token here and the ENGINE
 * answers; the share domain keeps only what the engine does not decide (the
 * kill switch, view accounting, and which refusal a denied caller is told).
 *
 * Three ADR-057 invariants live in what this seam passes, not in what it
 * checks:
 *
 *   - POSSESSION, NOT EXISTENCE. The token rides the scope as `shareTokens`,
 *     and `collectResourceGrants` only reads rows whose token was presented.
 *     A trace id alone reaches no grant, so the id-guessing hole stays shut.
 *   - THE PROJECT ANCHOR. The scope is resolved from the project's STORED
 *     lineage (`resolveResourceScopeRef` reads it, never the request), and
 *     `matchResourceGrant` requires `grant.projectId === scope.projectId` — a
 *     token minted in one project can never reach the same resource id in
 *     another (#4692).
 *   - LIVENESS. Expiry and the view budget are filtered by the collector
 *     (`isLiveShareLink`) before the engine sees a row. That filter stays
 *     where it is: view CONSUMPTION has a different writer (`GrantUsage`) and
 *     stays in `ShareService`.
 */
import {
  type AuthzDecision,
  type AuthzPermission,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  permissionSatisfiedBy,
  type ResourceGrant,
  type ShareableResourceKind,
} from "@langwatch/authz";
import { RESOURCE_KIND_TO_DB } from "@langwatch/authz-server";
import type { ShareResourceType } from "./repositories/share.repository";

/**
 * The share domain's stored spelling as the engine's resource kind, INVERTED
 * from the ledger's one mapping rather than restated beside it — the two
 * spellings then cannot drift apart (the same reasoning that put
 * `RESOURCE_KIND_TO_DB` in one place).
 */
const KIND_BY_RESOURCE_TYPE = Object.fromEntries(
  Object.entries(RESOURCE_KIND_TO_DB).map(([kind, stored]) => [stored, kind]),
) as Record<ShareResourceType, ShareableResourceKind>;

/** The checking half of the engine, as the narrow port this seam needs. */
export interface ShareAccessAuthzPort {
  check(args: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: AuthzScopeRef;
  }): Promise<AuthzDecision>;
}

/** The collecting half: scope resolution and the resource tier's own rows. */
export interface ShareAccessScopePort {
  resolveResourceScopeRef(args: {
    projectId: string;
    kind: ShareableResourceKind;
    id: string;
    parentThreadId?: string;
    shareTokens?: readonly string[];
  }): Promise<AuthzScopeRef | null>;
  collectResourceGrants(args: {
    scope: AuthzScopeRef;
  }): Promise<ResourceGrant[]>;
}

/**
 * How the allow was reached. Never copy for a caller — a refusal says nothing
 * about which leg denied it — but the tier IS the contract, so tests and logs
 * can tell "the engine's resource tier granted this" from "an ordinary project
 * binding would have".
 */
export type ShareAccessVia = "resource-grant" | "project-audience";

export type ShareAccessOutcome = {
  allowed: boolean;
  via?: ShareAccessVia;
};

export interface ShareAccessDecider {
  /**
   * Does the presented token authorize `permission` on this resource? One
   * answer, no explanation: a share refusal must not disclose which of
   * "no such token", "expired", "spent" or "not your audience" it was, and
   * the caller that needs to pick a message derives it from the link it
   * already holds.
   */
  decide(args: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    /** The token the request PRESENTED. Nothing else activates a grant. */
    token: string;
  }): Promise<ShareAccessOutcome>;
}

const DENIED: ShareAccessOutcome = { allowed: false };

export function engineShareAccessDecider({
  authz,
  scopes,
}: {
  authz: ShareAccessAuthzPort;
  scopes: ShareAccessScopePort;
}): ShareAccessDecider {
  /**
   * The one place this seam widens on the engine's own answer, and it is a
   * PARITY compensation, not a policy of its own.
   *
   * `audienceMatches` resolves a PROJECT audience through PROJECT-scoped
   * bindings alone — the collector calls this its KNOWN NARROWING (C5) — while
   * the path this replaces asked whether the viewer holds the permission ON
   * the project. Almost nobody reaches a project through a PROJECT-scoped
   * binding (membership arrives as a TEAM binding), so taking the narrow
   * answer would silently kill every "Members of this project" link. Until C5
   * stores membership audiences, the project-tier question is asked of the
   * SAME engine, which is what keeps the two answers identical.
   *
   * It widens the AUDIENCE and nothing else: the fallback only runs when a
   * live, possessed grant carrying the requested permission names a project
   * audience, so possession, expiry, the view budget, the project anchor and
   * the link's own permission all remain the collector's and the engine's.
   */
  const projectAudience = async ({
    principal,
    permission,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: Extract<AuthzScopeRef, { type: "resource" }>;
  }): Promise<ShareAccessOutcome> => {
    const grants = await scopes.collectResourceGrants({ scope });
    const projectAudienced = grants.some(
      (grant) =>
        grant.audience.kind === "project" &&
        grant.audience.id === scope.projectId &&
        grant.projectId === scope.projectId &&
        permissionSatisfiedBy({
          granted: new Set([grant.permission]),
          requested: permission,
        }),
    );
    if (!projectAudienced) return DENIED;

    const decision = await authz.check({
      principal,
      permission,
      scope: {
        type: "project",
        id: scope.projectId,
        teamId: scope.teamId,
        organizationId: scope.organizationId,
      },
    });
    return decision.allowed
      ? { allowed: true, via: "project-audience" }
      : DENIED;
  };

  return {
    async decide({
      principal,
      permission,
      projectId,
      resourceType,
      resourceId,
      token,
    }): Promise<ShareAccessOutcome> {
      const scope = await scopes.resolveResourceScopeRef({
        projectId,
        kind: KIND_BY_RESOURCE_TYPE[resourceType],
        id: resourceId,
        shareTokens: [token],
      });
      // A project that no longer exists resolves to no scope at all, which is
      // the same nothing an unknown token reaches.
      if (scope?.type !== "resource") return DENIED;

      const decision = await authz.check({ principal, permission, scope });
      // The RESOURCE TIER, and only it, answers for a share link. The engine's
      // walk reaches `resourceGrantStep` last, so a project member holding an
      // ordinary binding on the resource's lineage is allowed at a resource
      // scope by `bindingsStep` — before the token is ever consulted. Honouring
      // that here would hand a member a link its own expiry had killed, and
      // would consume a view against a token that granted nothing. Their
      // in-app read is a different question, asked at the project scope.
      if (decision.allowed && decision.via === "resource-grant") {
        return { allowed: true, via: "resource-grant" };
      }

      return await projectAudience({ principal, permission, scope });
    },
  };
}

/**
 * ADR-092 stage A4 — shadow mode. Behind the app's shadow flag, every legacy
 * resolver fires an async engine comparison after answering. Mismatches are
 * logged with both verdicts and never affect the response; gate A is seven
 * quiet days of these logs.
 *
 * Known-divergence classification: the legacy API-key resolver applies no
 * lite-member cap while the legacy tRPC path does (ADR-092 Context #1/#10).
 * The engine implements the tRPC semantics, so an EXTERNAL owner's key being
 * allowed by legacy and DENIED by the engine is the pre-existing escalation
 * surfacing, not an engine bug — tagged `external-cap`. The reverse
 * direction is not: an engine ALLOW where legacy denied has nothing to do
 * with the missing cap, so it stays untagged and lands on the dashboard as a
 * real mismatch. Second family: the legacy key ceiling falls back to TeamUser
 * membership on ANY owner-binding denial, while the engine (like the tRPC
 * path) gates that fallback on having no chain bindings — tagged
 * `ceiling-legacy-fallback`.
 *
 * Every environment read this service needs arrives through its constructor
 * options; the app's composition root owns the env.
 */
import {
  AuthzEngine,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz";
import { createLogger } from "@langwatch/observability";
import type { AuthzCollectorService } from "./authz-collector.service";

const logger = createLogger("langwatch:authz:shadow");

export type AuthzShadowOptions = {
  /** Fraction of checks to compare, read per check: 0 disables shadow mode
   *  entirely, 1 compares every check. */
  sampleRate: () => number;
  /** Mirrors isDemoProject()'s dynamic env read. */
  demoProjectId: () => string | undefined;
};

function logOutcome({
  caller,
  legacyAllowed,
  engineAllowed,
  permission,
  scope,
  principal,
  denialReason,
  knownDivergence,
}: {
  caller: string;
  legacyAllowed: boolean;
  engineAllowed: boolean;
  permission: string;
  scope: AuthzScopeRef | null;
  principal: AuthzPrincipalRef;
  denialReason?: string;
  knownDivergence?: string;
}) {
  if (legacyAllowed === engineAllowed) return;
  logger.warn(
    {
      caller,
      permission,
      scopeType: scope?.type ?? "unresolved",
      scopeId: scope?.id,
      principalType: principal.type,
      legacyAllowed,
      engineAllowed,
      denialReason,
      knownDivergence,
    },
    "authz shadow mismatch",
  );
}

/** The two documented divergence families (see the module header). */
function apiKeyKnownDivergence({
  ownerGrants,
  legacyAllowed,
  engineAllowed,
}: {
  ownerGrants: CollectedGrants | null;
  legacyAllowed: boolean;
  engineAllowed: boolean;
}): string | undefined {
  // Direction matters: only legacy-allowed / engine-denied is the missing
  // lite-member cap surfacing. An engine over-allow for the same owner is a
  // different bug and must not be filed as known divergence.
  if (
    ownerGrants?.organizationRole === "EXTERNAL" &&
    legacyAllowed &&
    !engineAllowed
  ) {
    return "external-cap";
  }
  const hasLegacyRows = (ownerGrants?.legacyTeamMemberships.length ?? 0) > 0;
  if (legacyAllowed && !engineAllowed && hasLegacyRows) {
    return "ceiling-legacy-fallback";
  }
  return undefined;
}

/**
 * The legacy resolvers' fire-and-forget engine comparison. The app composes
 * ONE instance in its runtime; calls never throw, never block, never change
 * the response.
 */
export class AuthzShadowService {
  private readonly engine = new AuthzEngine();

  constructor(
    private readonly collector: AuthzCollectorService,
    private readonly options: AuthzShadowOptions,
  ) {}

  private sampled(): boolean {
    const rate = this.options.sampleRate();
    if (!(rate > 0)) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
  }

  userPermissionCheck({
    userId,
    permission,
    legacyAllowed,
    projectId,
    teamId,
    organizationId,
    caller,
    fromApiKeyPath = false,
  }: {
    userId: string;
    permission: string;
    legacyAllowed: boolean;
    projectId?: string;
    teamId?: string;
    organizationId?: string;
    caller: string;
    /** Set by the legacy API-key resolvers, which apply no lite-member cap
     *  - it is what makes an EXTERNAL mismatch here a known divergence. The
     *  caller label is free-form and must never be parsed for this. */
    fromApiKeyPath?: boolean;
  }): void {
    if (!this.sampled()) return;
    void (async () => {
      try {
        const scope = await this.collector.resolveScopeRef({
          projectId,
          teamId,
          organizationId,
        });
        if (!scope) {
          logOutcome({
            caller,
            legacyAllowed,
            engineAllowed: false,
            permission,
            scope: null,
            principal: { type: "user", id: userId },
          });
          return;
        }
        const grants = await this.collector.collectGrants({
          principal: { type: "user", id: userId },
          organizationId:
            scope.type === "organization" ? scope.id : scope.organizationId,
        });
        const decision = this.engine.decide({
          grants,
          permission,
          scope,
          demoProjectId: this.options.demoProjectId(),
        });
        logOutcome({
          caller,
          legacyAllowed,
          engineAllowed: decision.allowed,
          permission,
          scope,
          principal: { type: "user", id: userId },
          denialReason: decision.denialReason,
          knownDivergence:
            grants.organizationRole === "EXTERNAL" &&
            fromApiKeyPath &&
            legacyAllowed &&
            !decision.allowed
              ? "external-cap"
              : undefined,
        });
      } catch (error) {
        logger.debug({ error, caller }, "authz shadow comparison failed");
      }
    })();
  }

  /**
   * The batched resolver's comparison: one sampling draw, one grant
   * collection, N decisions against that snapshot. The per-scope loop the
   * batch caller would otherwise write costs a resolveScopeRef plus a
   * collectGrants PER SCOPE — a page enumerating a hundred scopes turning
   * legacy's four flat queries into hundreds of detached ones (the same
   * fan-out api-key.service.ts:736 documents starving the pool).
   *
   * Scope refs are built from the lineage the caller already resolved —
   * these ids come out of legacy's own org-scoped batch resolution, not the
   * request — with resolveScopeRef as the fallback for a project whose team
   * the caller does not know.
   */
  userBatchPermissionCheck({
    userId,
    permission,
    organizationId,
    teams,
    projects,
    caller,
  }: {
    userId: string;
    permission: string;
    organizationId: string;
    teams: ReadonlyArray<{ teamId: string; legacyAllowed: boolean }>;
    projects: ReadonlyArray<{
      projectId: string;
      teamId?: string | undefined;
      legacyAllowed: boolean;
    }>;
    caller: string;
  }): void {
    if (!this.sampled()) return;
    void (async () => {
      try {
        const principal: AuthzPrincipalRef = { type: "user", id: userId };
        const grants = await this.collector.collectGrants({
          principal,
          organizationId,
        });
        const demoProjectId = this.options.demoProjectId();
        const scoped: Array<{ scope: AuthzScopeRef | null; legacyAllowed: boolean }> =
          [
            ...teams.map(({ teamId, legacyAllowed }) => ({
              scope: {
                type: "team" as const,
                id: teamId,
                organizationId,
              },
              legacyAllowed,
            })),
            ...(await Promise.all(
              projects.map(async ({ projectId, teamId, legacyAllowed }) => ({
                scope: teamId
                  ? {
                      type: "project" as const,
                      id: projectId,
                      teamId,
                      organizationId,
                    }
                  : await this.collector.resolveScopeRef({ projectId }),
                legacyAllowed,
              })),
            )),
          ];
        for (const { scope, legacyAllowed } of scoped) {
          if (!scope) {
            logOutcome({
              caller,
              legacyAllowed,
              engineAllowed: false,
              permission,
              scope: null,
              principal,
            });
            continue;
          }
          const decision = this.engine.decide({
            grants,
            permission,
            scope,
            demoProjectId,
          });
          logOutcome({
            caller,
            legacyAllowed,
            engineAllowed: decision.allowed,
            permission,
            scope,
            principal,
            denialReason: decision.denialReason,
          });
        }
      } catch (error) {
        logger.debug({ error, caller }, "authz shadow comparison failed");
      }
    })();
  }

  apiKeyPermissionCheck({
    apiKeyId,
    ownerUserId,
    organizationId,
    permission,
    legacyAllowed,
    projectId,
    teamId,
    caller,
  }: {
    apiKeyId: string;
    ownerUserId: string | null;
    organizationId: string;
    permission: string;
    legacyAllowed: boolean;
    projectId?: string;
    teamId?: string;
    caller: string;
  }): void {
    if (!this.sampled()) return;
    void (async () => {
      try {
        const scope = await this.collector.resolveScopeRef({
          projectId,
          teamId,
          organizationId: projectId || teamId ? undefined : organizationId,
        });
        if (!scope) {
          // An id legacy answered on that the engine cannot resolve is
          // itself a divergence worth seeing — the same unresolved outcome
          // the user path logs.
          logOutcome({
            caller,
            legacyAllowed,
            engineAllowed: false,
            permission,
            scope: null,
            principal: { type: "apiKey", id: apiKeyId },
          });
          return;
        }
        const [keyGrants, ownerGrants] = await Promise.all([
          this.collector.collectGrants({
            principal: { type: "apiKey", id: apiKeyId },
            organizationId,
          }),
          ownerUserId
            ? this.collector.collectGrants({
                principal: { type: "user", id: ownerUserId },
                organizationId,
              })
            : Promise.resolve(null),
        ]);
        const decision = this.engine.decideWithCeiling({
          keyGrants,
          ownerGrants,
          permission,
          scope,
          demoProjectId: this.options.demoProjectId(),
        });
        logOutcome({
          caller,
          legacyAllowed,
          engineAllowed: decision.allowed,
          permission,
          scope,
          principal: { type: "apiKey", id: apiKeyId },
          denialReason: decision.denialReason,
          knownDivergence: apiKeyKnownDivergence({
            ownerGrants,
            legacyAllowed,
            engineAllowed: decision.allowed,
          }),
        });
      } catch (error) {
        logger.debug({ error, caller }, "authz shadow comparison failed");
      }
    })();
  }
}

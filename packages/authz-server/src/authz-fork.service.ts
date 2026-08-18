/**
 * ADR-092 delivery-plan PR 3 (decisions D-PR3-2 / D-PR3-11) — the fork. Where
 * `AuthzShadowService` answers with legacy and compares the engine after the
 * fact, this service answers with the ENGINE and compares legacy after the
 * fact. Same two resolvers, same comparison, primacy swapped — which is the
 * whole of what "cutting an organization over" means.
 *
 * Who decides which of the two runs is not this service's business: the app
 * asks its per-organization cutover gate at each seam and composes one of the
 * two. So a cut-over organization is served here, everyone else stays exactly
 * where they were, and neither can be half-switched inside one request.
 *
 * The shape every method holds to:
 *
 *   1. resolve the scope, collect the grants, decide — all AWAITED, because
 *      this is the answer the caller is waiting for;
 *   2. fire the caller's `legacy` thunk detached and log the comparison. The
 *      thunk's cost, its failures and its latency are the reverse-shadow's
 *      problem, never the caller's — a legacy resolver that throws (or that
 *      was handed a transaction which has since closed) becomes one
 *      "authz fork comparison failed" line and nothing else.
 *
 * Logging mirrors shadow exactly, plus `primary: "engine"` so one query
 * separates the two populations: DEBUG `authz fork match`, warn
 * `authz fork mismatch`, warn `authz fork comparison failed`. A match is the
 * expected outcome on a request-rate hot path — at info it is a line per
 * check per pod, which is the same reasoning that put shadow's match line at
 * debug. Silence at warn is therefore the good news; the proof that the
 * comparison is running at all is the info-level rate announcement, one line
 * per change.
 *
 * The comparison DEFAULTS ON at 1.0, and that default is the design rather
 * than an oversight: a cut-over organization is decided by the engine on
 * every check by definition, and comparing every one of those is what earns
 * the confidence to contract legacy away (PR 4). The rate exists so an
 * operator can throttle a detached second resolver under load without a
 * deploy — the same `parseShadowRate` semantics shadow reads — and the
 * in-flight bound exists because these thunks are fire-and-forget: nothing
 * upstream applies back-pressure to them, so a slow legacy resolver would
 * otherwise queue one unresolved promise (and one database connection) per
 * check with no ceiling. Over the bound the comparison is dropped, never
 * awaited.
 *
 * `compare: false` silences the comparison for callers that ask the same
 * question dozens of times in a loop; it never silences the decision.
 *
 * An unresolvable scope DENIES, and says so through the same comparison — the
 * fail-closed posture shadow already documents, now load-bearing.
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
import type { OrganizationRole } from "./authz-read.repository";

const logger = createLogger("langwatch:authz:fork");

export type AuthzForkOptions = {
  /** Mirrors isDemoProject()'s dynamic env read. */
  demoProjectId: () => string | undefined;
  /**
   * How much of the traffic runs the detached legacy comparison, read per
   * check so it can be turned down without a deploy. Same semantics as
   * shadow's `sampleRate`: `<= 0` off, `>= 1` every check, anything between
   * is a per-check coin toss.
   *
   * Defaults to 1 — see the header: the comparison is the evidence PR 4 is
   * built on, so it is on unless somebody deliberately turns it down.
   */
  comparisonRate?: () => number;
  /**
   * Ceiling on comparisons in flight at once, per service instance. The
   * thunks are detached, so this is the only thing standing between a slow
   * legacy resolver and unbounded queued work. Defaults to 100.
   */
  maxInFlightComparisons?: number;
};

/** The default when the composition root names no rate: every check. */
const DEFAULT_COMPARISON_RATE = 1;

/** The default in-flight ceiling; generous enough that a healthy resolver
 *  never reaches it, small enough that a stalled one cannot pile up. */
const DEFAULT_MAX_IN_FLIGHT_COMPARISONS = 100;

/**
 * The engine's answer in the shape the legacy seams return: the organization
 * role rides along because `PermissionResult` carries it, and the collected
 * snapshot already read the membership row the legacy path would have.
 */
export type ForkedDecision = {
  allowed: boolean;
  organizationRole: OrganizationRole | null;
};

/** `decideUserPermissionsAny`'s answer: which candidate settled it. */
export type ForkedAnyDecision = ForkedDecision & {
  matchedPermission?: string;
};

export type ForkedBatchDecision = {
  teams: Map<string, boolean>;
  projects: Map<string, boolean>;
  organizationRole: OrganizationRole | null;
};

/** A legacy resolver, as a thunk the reverse-shadow runs detached. */
type LegacyThunk<T> = () => Promise<T>;

export class AuthzForkService {
  private readonly engine = new AuthzEngine();
  /** Comparisons started and not yet settled, for the in-flight bound. */
  private inFlightComparisons = 0;
  /**
   * The rate announcement latch is static for the reason shadow's is: the app
   * composes a fresh service per request, so a per-instance latch would
   * announce on every check instead of on every change.
   */
  private static lastAnnouncedRate: number | undefined;

  static resetRateAnnouncement(): void {
    AuthzForkService.lastAnnouncedRate = undefined;
  }

  constructor(
    private readonly collector: AuthzCollectorService,
    private readonly options: AuthzForkOptions,
  ) {}

  /**
   * One user, one permission, one scope — the shape behind the project, team
   * and organization seams alike. `projectId` / `teamId` / `organizationId`
   * are the same triple the legacy resolvers carry, resolved most-specific
   * first by the collector.
   */
  async decideUserPermission({
    userId,
    permission,
    projectId,
    teamId,
    organizationId,
    caller,
    legacy,
    compare = true,
  }: {
    userId: string;
    permission: string;
    projectId?: string;
    teamId?: string;
    organizationId?: string;
    caller: string;
    legacy: LegacyThunk<boolean>;
    /** False silences the COMPARISON only (the skipShadow contract). */
    compare?: boolean;
  }): Promise<ForkedDecision> {
    const principal: AuthzPrincipalRef = { type: "user", id: userId };
    const scope = await this.collector.resolveScopeRef({
      projectId,
      teamId,
      organizationId,
    });
    if (!scope) {
      // An id the engine cannot place is a denial, and one worth seeing: the
      // legacy resolver may well have answered on it.
      this.compareAsync({
        caller,
        permission,
        scope: null,
        principal,
        engineAllowed: false,
        legacy,
        compare,
      });
      return { allowed: false, organizationRole: null };
    }
    const grants = await this.collectFor({ principal, scope });
    const decision = this.engine.decide({
      grants,
      permission,
      scope,
      demoProjectId: this.options.demoProjectId(),
    });
    this.compareAsync({
      caller,
      permission,
      scope,
      principal,
      engineAllowed: decision.allowed,
      denialReason: decision.denialReason,
      legacy,
      compare,
    });
    return {
      allowed: decision.allowed,
      organizationRole: grants.organizationRole,
    };
  }

  /**
   * "Any one of these permissions is enough", in the order given. One scope
   * resolution and one grant collection serve every candidate — the legacy
   * loop re-queries per permission, and matching its semantics does not
   * require matching its query count.
   *
   * First allow wins and the walk stops there, exactly as the legacy loop
   * returns on its first grant, so the two answer the same question even
   * though only one of them is asked per candidate.
   */
  async decideUserPermissionsAny({
    userId,
    permissions,
    projectId,
    caller,
    legacy,
    compare = true,
  }: {
    userId: string;
    permissions: readonly string[];
    projectId: string;
    caller: string;
    legacy: LegacyThunk<{ allowed: boolean }>;
    compare?: boolean;
  }): Promise<ForkedAnyDecision> {
    const principal: AuthzPrincipalRef = { type: "user", id: userId };
    const scope = await this.collector.resolveScopeRef({ projectId });
    const legacyAllowed: LegacyThunk<boolean> = async () =>
      (await legacy()).allowed;
    if (!scope) {
      this.compareAsync({
        caller,
        permission: permissions.join(" | "),
        scope: null,
        principal,
        engineAllowed: false,
        legacy: legacyAllowed,
        compare,
      });
      return { allowed: false, organizationRole: null };
    }
    const grants = await this.collectFor({ principal, scope });
    const demoProjectId = this.options.demoProjectId();
    let matched: string | undefined;
    let lastDenialReason: string | undefined;
    for (const permission of permissions) {
      const decision = this.engine.decide({
        grants,
        permission,
        scope,
        demoProjectId,
      });
      lastDenialReason = decision.denialReason;
      if (decision.allowed) {
        matched = permission;
        break;
      }
    }
    this.compareAsync({
      caller,
      // The candidate that settled it when one did; the whole list when none
      // did, because that is the question legacy was asked.
      permission: matched ?? permissions.join(" | "),
      scope,
      principal,
      engineAllowed: matched !== undefined,
      denialReason: matched ? undefined : lastDenialReason,
      legacy: legacyAllowed,
      compare,
    });
    return {
      allowed: matched !== undefined,
      ...(matched ? { matchedPermission: matched } : {}),
      organizationRole: grants.organizationRole,
    };
  }

  /**
   * One permission across many scopes in one organization: one collection, N
   * pure decisions. The per-scope alternative would turn the legacy batch's
   * four flat queries into a collect per scope — the pool-starving fan-out
   * api-key.service.ts documents, now on the answering path rather than the
   * comparing one.
   *
   * Scope refs are built from the lineage the caller already holds; only a
   * project whose team the caller does not know costs a resolution.
   */
  async decideUserBatchPermissions({
    userId,
    permission,
    organizationId,
    teams,
    projects,
    caller,
    legacy,
    compare = true,
  }: {
    userId: string;
    permission: string;
    organizationId: string;
    teams: ReadonlyArray<{ teamId: string }>;
    projects: ReadonlyArray<{ projectId: string; teamId?: string | undefined }>;
    caller: string;
    legacy: LegacyThunk<{
      teams: Map<string, boolean>;
      projects: Map<string, boolean>;
    }>;
    compare?: boolean;
  }): Promise<ForkedBatchDecision> {
    const principal: AuthzPrincipalRef = { type: "user", id: userId };
    const grants = await this.collector.collectGrants({
      principal,
      organizationId,
    });
    const demoProjectId = this.options.demoProjectId();
    const decideAt = (scope: AuthzScopeRef | null) =>
      scope
        ? this.engine.decide({ grants, permission, scope, demoProjectId })
            .allowed
        : false;

    const teamsMap = new Map<string, boolean>(
      teams.map(({ teamId }) => [
        teamId,
        decideAt({ type: "team", id: teamId, organizationId }),
      ]),
    );
    const projectsMap = new Map<string, boolean>();
    for (const { projectId, teamId } of projects) {
      const scope: AuthzScopeRef | null = teamId
        ? { type: "project", id: projectId, teamId, organizationId }
        : await this.collector.resolveScopeRef({ projectId });
      projectsMap.set(projectId, decideAt(scope));
    }

    // One admission decision for the whole batch: the maps are compared as a
    // unit, and half a batch's lines would read as a batch that disagreed.
    if (this.admitsComparison(compare)) {
      this.runDetached(caller, async () => {
        try {
          const legacyMaps = await legacy();
          for (const [teamId, engineAllowed] of teamsMap) {
            this.logOutcome({
              caller,
              permission,
              scope: { type: "team", id: teamId, organizationId },
              principal,
              engineAllowed,
              legacyAllowed: legacyMaps.teams.get(teamId) === true,
            });
          }
          for (const [projectId, engineAllowed] of projectsMap) {
            this.logOutcome({
              caller,
              permission,
              // The scope label only names the id; the project's team is not
              // part of what the comparison is about.
              scope: {
                type: "project",
                id: projectId,
                teamId: "",
                organizationId,
              },
              principal,
              engineAllowed,
              legacyAllowed: legacyMaps.projects.get(projectId) === true,
            });
          }
        } catch (error) {
          logger.warn({ error, caller }, "authz fork comparison failed");
        }
      });
    }

    return {
      teams: teamsMap,
      projects: projectsMap,
      organizationRole: grants.organizationRole,
    };
  }

  /**
   * One named principal — user OR api key — at one scope, with NO owner
   * ceiling. That absence is the contract of the legacy function this forks
   * (`checkRoleBindingPermission` reports the principal's own bindings and
   * nothing else); the ceiling belongs to `decideApiKeyPermission`, which is
   * where legacy applies it too.
   */
  async decidePrincipalPermission({
    principal,
    organizationId,
    projectId,
    teamId,
    permission,
    caller,
    legacy,
    compare = true,
  }: {
    principal: { type: "user" | "apiKey"; id: string };
    organizationId: string;
    projectId?: string;
    teamId?: string;
    permission: string;
    caller: string;
    legacy: LegacyThunk<boolean>;
    compare?: boolean;
  }): Promise<boolean> {
    const principalRef: AuthzPrincipalRef =
      principal.type === "user"
        ? { type: "user", id: principal.id }
        : { type: "apiKey", id: principal.id };
    const scope = await this.resolveScopeIn({
      projectId,
      teamId,
      organizationId,
    });
    if (!scope) {
      this.compareAsync({
        caller,
        permission,
        scope: null,
        principal: principalRef,
        engineAllowed: false,
        legacy,
        compare,
      });
      return false;
    }
    const grants = await this.collector.collectGrants({
      principal: principalRef,
      organizationId,
    });
    const decision = this.engine.decide({
      grants,
      permission,
      scope,
      demoProjectId: this.options.demoProjectId(),
    });
    this.compareAsync({
      caller,
      permission,
      scope,
      principal: principalRef,
      engineAllowed: decision.allowed,
      denialReason: decision.denialReason,
      legacy,
      compare,
    });
    return decision.allowed;
  }

  /**
   * ADR-092 §9 as the answering path: effective(key) = grants(key) ∩
   * grants(owner). The two snapshots are collected in parallel because
   * neither depends on the other, and a service key (no owner) carries no
   * ceiling at all.
   */
  async decideApiKeyPermission({
    apiKeyId,
    ownerUserId,
    organizationId,
    projectId,
    teamId,
    permission,
    caller,
    legacy,
    compare = true,
  }: {
    apiKeyId: string;
    ownerUserId: string | null;
    organizationId: string;
    projectId?: string;
    teamId?: string;
    permission: string;
    caller: string;
    legacy: LegacyThunk<boolean>;
    compare?: boolean;
  }): Promise<boolean> {
    const principal: AuthzPrincipalRef = { type: "apiKey", id: apiKeyId };
    const scope = await this.resolveScopeIn({
      projectId,
      teamId,
      organizationId,
    });
    if (!scope) {
      this.compareAsync({
        caller,
        permission,
        scope: null,
        principal,
        engineAllowed: false,
        legacy,
        compare,
      });
      return false;
    }
    const [keyGrants, ownerGrants] = await Promise.all([
      this.collector.collectGrants({ principal, organizationId }),
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
    this.compareAsync({
      caller,
      permission,
      scope,
      principal,
      engineAllowed: decision.allowed,
      denialReason: decision.denialReason,
      legacy,
      compare,
      knownDivergence: (legacyAllowed) =>
        apiKeyKnownDivergence({
          ownerGrants,
          legacyAllowed,
          engineAllowed: decision.allowed,
        }),
    });
    return decision.allowed;
  }

  /** Most-specific-first, the same order every legacy seam resolves in. */
  private async resolveScopeIn({
    projectId,
    teamId,
    organizationId,
  }: {
    projectId?: string;
    teamId?: string;
    organizationId: string;
  }): Promise<AuthzScopeRef | null> {
    return this.collector.resolveScopeRef({
      projectId,
      teamId,
      organizationId: projectId || teamId ? undefined : organizationId,
    });
  }

  private async collectFor({
    principal,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    scope: AuthzScopeRef;
  }): Promise<CollectedGrants> {
    return this.collector.collectGrants({
      principal,
      organizationId:
        scope.type === "organization" ? scope.id : scope.organizationId,
    });
  }

  /**
   * The reverse shadow: the engine has already answered, so everything here
   * is detached. A thunk that throws is one warning — the caller has its
   * answer and must never learn that legacy struggled to agree.
   */
  private compareAsync({
    caller,
    permission,
    scope,
    principal,
    engineAllowed,
    denialReason,
    legacy,
    compare,
    knownDivergence,
  }: {
    caller: string;
    permission: string;
    scope: AuthzScopeRef | null;
    principal: AuthzPrincipalRef;
    engineAllowed: boolean;
    denialReason?: string;
    legacy: LegacyThunk<boolean>;
    compare: boolean;
    knownDivergence?: (legacyAllowed: boolean) => string | undefined;
  }): void {
    if (!this.admitsComparison(compare)) return;
    this.runDetached(caller, async () => {
      try {
        const legacyAllowed = await legacy();
        this.logOutcome({
          caller,
          permission,
          scope,
          principal,
          engineAllowed,
          legacyAllowed,
          denialReason,
          knownDivergence: knownDivergence?.(legacyAllowed),
        });
      } catch (error) {
        logger.warn({ error, caller }, "authz fork comparison failed");
      }
    });
  }

  /**
   * Whether THIS check's comparison runs: the caller has to want it, the
   * rate has to admit it, and there has to be room in flight for it. All
   * three are checked before the thunk is touched, so a refused comparison
   * costs nothing at all — not a query, not a promise.
   */
  private admitsComparison(compare: boolean): boolean {
    if (!compare) return false;
    if (!this.sampled()) return false;
    const ceiling =
      this.options.maxInFlightComparisons ?? DEFAULT_MAX_IN_FLIGHT_COMPARISONS;
    if (this.inFlightComparisons >= ceiling) {
      // Debug, not warn: shedding a detached comparison is the bound doing
      // its job, and the caller's answer is unaffected either way.
      logger.debug(
        { inFlight: this.inFlightComparisons, ceiling },
        "authz fork comparison shed",
      );
      return false;
    }
    return true;
  }

  private sampled(): boolean {
    const rate = (this.options.comparisonRate ?? (() => DEFAULT_COMPARISON_RATE))();
    this.announceRate(rate);
    if (!(rate > 0)) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
  }

  private announceRate(rate: number): void {
    if (rate === AuthzForkService.lastAnnouncedRate) return;
    const wasEnabled = (AuthzForkService.lastAnnouncedRate ?? 0) > 0;
    AuthzForkService.lastAnnouncedRate = rate;
    if (rate > 0) {
      logger.info({ comparisonRate: rate }, "authz fork comparison enabled");
    } else if (wasEnabled) {
      logger.info({ comparisonRate: rate }, "authz fork comparison disabled");
    }
  }

  /** Run the comparison detached, counted in and out so the in-flight bound
   *  means something. The body already swallows its own failures; the
   *  `finally` is what guarantees the counter comes back down anyway. */
  private runDetached(caller: string, body: () => Promise<void>): void {
    this.inFlightComparisons += 1;
    void body()
      .catch((error: unknown) => {
        logger.warn({ error, caller }, "authz fork comparison failed");
      })
      .finally(() => {
        this.inFlightComparisons -= 1;
      });
  }

  /**
   * Every admitted comparison logs — the match line is the proof that both
   * resolvers ran and agreed, so silence at warn means "they agreed", and
   * the proof that comparing is happening at all is the rate announcement.
   * `primary: "engine"` is what separates these lines from shadow's: same
   * two verdicts, opposite authority.
   */
  private logOutcome({
    caller,
    permission,
    scope,
    principal,
    engineAllowed,
    legacyAllowed,
    denialReason,
    knownDivergence,
  }: {
    caller: string;
    permission: string;
    scope: AuthzScopeRef | null;
    principal: AuthzPrincipalRef;
    engineAllowed: boolean;
    legacyAllowed: boolean;
    denialReason?: string;
    knownDivergence?: string;
  }): void {
    const detail = {
      caller,
      permission,
      scopeType: scope?.type ?? "unresolved",
      scopeId: scope?.id,
      principalType: principal.type,
      legacyAllowed,
      engineAllowed,
      denialReason,
      knownDivergence,
      primary: "engine",
    };
    if (legacyAllowed === engineAllowed) {
      logger.debug(detail, "authz fork match");
      return;
    }
    logger.warn(detail, "authz fork mismatch");
  }
}

/**
 * The one divergence family that still means something once the engine is
 * primary: the legacy API-key resolver applies no lite-member cap, so an
 * EXTERNAL owner's key that legacy allowed and the engine denies is the
 * pre-existing escalation being CLOSED by the cutover, not a regression
 * (ADR-092 Context #1/#10, and the same classification shadow.ts documents).
 * The other direction stays untagged: an engine allow where legacy denied has
 * nothing to do with the missing cap.
 */
function apiKeyKnownDivergence({
  ownerGrants,
  legacyAllowed,
  engineAllowed,
}: {
  ownerGrants: CollectedGrants | null;
  legacyAllowed: boolean;
  engineAllowed: boolean;
}): string | undefined {
  if (!legacyAllowed || engineAllowed) return undefined;
  if (ownerGrants?.organizationRole === "EXTERNAL") return "external-cap";
  if ((ownerGrants?.legacyTeamMemberships.length ?? 0) > 0) {
    return "ceiling-legacy-fallback";
  }
  return undefined;
}

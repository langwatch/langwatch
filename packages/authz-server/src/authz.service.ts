/**
 * ADR-092 §11 — the checking API, a service over the collector. The app
 * builds ONE instance in its composition root
 * (platform/app/src/server/app-layer/authz/runtime.ts) and everything asks it:
 *
 *   authz.can({ principal, permission: "prompts:update", scope })
 *   authz.check({ ... })                → full AuthzDecision, never throws
 *   authz.effectivePermissions({ ... }) → string[] (feeds useCan)
 *
 * ADR-092 §9 — api-key principals never answer from their own bindings
 * alone: effective(key) = grants(key) ∩ grants(owner), so demoting the
 * owner shrinks every key they own on the next check. A key with no owner
 * (a service key) has no ceiling, which is the legacy behaviour.
 *
 * ADR-092 §6 step RECORD — denials emit one structured log line here. That
 * is the whole of RECORD today: nothing is PERSISTED, and the decision
 * store the A4 mismatch dashboard reads lands with it. Allows are not
 * logged at all yet, for the same reason.
 *
 * The §12 L1 epoch cache lives inside the instance: an entry is valid only
 * while its organization's epoch is unchanged, so a revoked binding is dead
 * on the caller's next request (the grant write bumps the epoch). An entry
 * also expires on absolute age, so a wedged epoch store cannot pin a stale
 * snapshot indefinitely. No epoch reader wired, epoch store down, or flag
 * off all mean the same thing - no caching, always correct, just slower.
 */
import {
  ALL_PERMISSIONS,
  AuthzEngine,
  type AuthzDecision,
  type AuthzPermission,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
  PermissionDeniedError,
  type ResourceGrant,
  scopeOrganizationId,
} from "@langwatch/authz";
// subpath alongside the passport primitives.
import { createLogger } from "@langwatch/observability";
import type { AuthzCollectorService } from "./authz-collector.service";
import type { AuthzReadRepository } from "./authz-read.repository";

const decisions = createLogger("langwatch:authz:decisions");

/** The app's redis-backed epoch store (src/server/app-layer/authz/epoch.ts). */
export type AuthzEpochReader = (args: {
  organizationId: string;
}) => Promise<number | null>;

const MAX_CACHE_ENTRIES = 10_000;
/** Absolute ceiling on a cached snapshot's life, epoch agreement or not. */
const DEFAULT_CACHE_MAX_AGE_MS = 30_000;

type CacheEntry = { epoch: number; grants: CollectedGrants; storedAt: number };

/** The loose ids a caller holds before a scope ref has been resolved. */
type ScopeIds = {
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

type OrganizationRoleOrNull = CollectedGrants["organizationRole"];

type CheckArgs = {
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
};

export type AuthzServiceOptions = {
  /** Omitted = never cache. */
  epochReader?: AuthzEpochReader;
  /** Internal rollout knob; omitted = cache off. The composition root
   *  supplies the env read. */
  cacheEnabled?: () => boolean;
  /** Mirrors isDemoProject()'s dynamic env read; omitted = demo off. The
   *  composition root supplies the env read. */
  demoProjectId?: () => string | undefined;
  /** Absolute cache-entry age bound; defaults to 30s. */
  cacheMaxAgeMs?: number;
};

export class AuthzService {
  private readonly engine = new AuthzEngine();
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly collector: AuthzCollectorService,
    private readonly options: AuthzServiceOptions = {},
  ) {}

  async check(args: CheckArgs): Promise<AuthzDecision> {
    const { decision } = await this.checkDetailed(args);
    return decision;
  }

  /**
   * check() plus the collected snapshot - for adapters that must also
   * surface legacy context fields (the tRPC middleware sets
   * ctx.organizationRole from it). For an api-key principal the snapshot
   * returned is the KEY's, not the owner's: the owner only ever caps.
   */
  async checkDetailed({ principal, permission, scope }: CheckArgs): Promise<{
    decision: AuthzDecision;
    grants: CollectedGrants;
  }> {
    const organizationId = scopeOrganizationId(scope);
    const [grants, resourceGrants, ownerGrants] = await Promise.all([
      this.collectCached({ principal, organizationId }),
      this.resourceGrantsFor(scope),
      this.ownerGrantsFor({ principal, organizationId }),
    ]);
    const decision = this.engine.decideWithCeiling({
      keyGrants: grants,
      ownerGrants,
      permission,
      scope,
      demoProjectId: this.demoProjectId(),
      resourceGrants,
    });
    recordDenial(decision);
    return { decision, grants };
  }

  async can(args: CheckArgs): Promise<boolean> {
    const decision = await this.check(args);
    return decision.allowed;
  }

  /**
   * The caller's full effective permission set at a scope — the frontend's
   * single source of truth (useCan). Computed by testing the whole registry
   * against one collected snapshot: pure decides over ~126 permissions.
   * The §9 owner ceiling applies here exactly as it does to a single
   * check, so a key's advertised set can never exceed its owner's.
   */
  async effectivePermissions({
    principal,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    scope: AuthzScopeRef;
  }): Promise<AuthzPermission[]> {
    const organizationId = scopeOrganizationId(scope);
    const [grants, resourceGrants, ownerGrants] = await Promise.all([
      this.collectCached({ principal, organizationId }),
      this.resourceGrantsFor(scope),
      this.ownerGrantsFor({ principal, organizationId }),
    ]);
    const demo = this.demoProjectId();
    return ALL_PERMISSIONS.filter(
      (permission) =>
        this.engine.decideWithCeiling({
          keyGrants: grants,
          ownerGrants,
          permission,
          scope,
          demoProjectId: demo,
          resourceGrants,
        }).allowed,
    );
  }

  /**
   * The same question as `check`, asked with the ids a caller already holds
   * instead of a resolved scope ref. Most call sites have a projectId or a
   * teamId and nothing else, and resolving the ref themselves is the step
   * they used to get wrong; the collector resolves it here, most specific
   * first.
   *
   * `ceiling: false` reports the named principal's own grants and nothing
   * else — the contract of the seams that answer "what does THIS binding
   * give you", which must not be capped by an api key's owner.
   */
  async checkByIds({
    principal,
    permission,
    projectId,
    teamId,
    organizationId,
    ceiling = true,
  }: ScopeIds & {
    principal: AuthzPrincipalRef;
    permission: string;
    ceiling?: boolean;
  }): Promise<{ allowed: boolean; organizationRole: OrganizationRoleOrNull }> {
    const scope = await this.resolveScope({ projectId, teamId, organizationId });
    if (!scope) return { allowed: false, organizationRole: null };

    const scopeOrg = scopeOrganizationId(scope);
    const pass = this.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.collector.collectGrants({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
      ceiling
        ? this.ownerGrantsFor({ principal, organizationId: scopeOrg, reader: pass })
        : Promise.resolve(null),
    ]);
    const decision = this.engine.decideWithCeiling({
      keyGrants: grants,
      ownerGrants,
      permission,
      scope,
      demoProjectId: this.demoProjectId(),
    });
    recordDenial(decision);
    return { allowed: decision.allowed, organizationRole: grants.organizationRole };
  }

  /**
   * "Any one of these is enough", in the order given, first allow wins. One
   * scope resolution and one collection serve every candidate — asking per
   * permission would re-query for an answer the first snapshot already holds.
   */
  async canAnyByIds({
    principal,
    permissions,
    projectId,
  }: {
    principal: AuthzPrincipalRef;
    permissions: readonly string[];
    projectId: string;
  }): Promise<{
    allowed: boolean;
    matchedPermission?: string;
    organizationRole: OrganizationRoleOrNull;
  }> {
    const scope = await this.collector.resolveScopeRef({ projectId });
    if (!scope) return { allowed: false, organizationRole: null };

    const grants = await this.collector.collectGrants({
      principal,
      organizationId: scopeOrganizationId(scope),
    });
    const demoProjectId = this.demoProjectId();
    const matched = permissions.find(
      (permission) =>
        this.engine.decide({ grants, permission, scope, demoProjectId }).allowed,
    );
    return {
      allowed: matched !== undefined,
      ...(matched ? { matchedPermission: matched } : {}),
      organizationRole: grants.organizationRole,
    };
  }

  /**
   * One permission across many scopes in one organization: one collection,
   * N pure decisions. Deciding per scope would turn a flat batch into a
   * collect per scope, which is the pool-starving fan-out this replaces.
   * Only a project whose team the caller does not already know costs a
   * resolution, and those resolve in parallel.
   */
  async canBatchByIds({
    principal,
    permission,
    organizationId,
    teams,
    projects,
  }: {
    principal: AuthzPrincipalRef;
    permission: string;
    organizationId: string;
    teams: ReadonlyArray<{ teamId: string }>;
    projects: ReadonlyArray<{ projectId: string; teamId?: string | undefined }>;
  }): Promise<{
    teams: Map<string, boolean>;
    projects: Map<string, boolean>;
    organizationRole: OrganizationRoleOrNull;
  }> {
    const grants = await this.collector.collectGrants({
      principal,
      organizationId,
    });
    const demoProjectId = this.demoProjectId();
    const allowedAt = (scope: AuthzScopeRef | null): boolean =>
      scope
        ? this.engine.decide({ grants, permission, scope, demoProjectId }).allowed
        : false;

    const resolvedProjects = await Promise.all(
      projects.map(async ({ projectId, teamId }): Promise<[string, boolean]> => [
        projectId,
        allowedAt(
          teamId
            ? { type: "project", id: projectId, teamId, organizationId }
            : await this.collector.resolveScopeRef({ projectId }),
        ),
      ]),
    );

    return {
      teams: new Map(
        teams.map(({ teamId }) => [
          teamId,
          allowedAt({ type: "team", id: teamId, organizationId }),
        ]),
      ),
      projects: new Map(resolvedProjects),
      organizationRole: grants.organizationRole,
    };
  }

  /** Most-specific-first, the order every seam resolves in: an explicit
   *  project or team wins over the organization it sits in. */
  private async resolveScope({
    projectId,
    teamId,
    organizationId,
  }: ScopeIds): Promise<AuthzScopeRef | null> {
    return this.collector.resolveScopeRef({
      projectId,
      teamId,
      organizationId: projectId || teamId ? undefined : organizationId,
    });
  }

  /**
   * ADR-092 §6 — render the walk for a decision against the CURRENT grant
   * snapshot, not the one the decision was made against: a grant write
   * between the decision and this call changes the rendered walk. Carrying
   * the decision's own snapshot lands with the stage E explain surface.
   */
  async explainDecision({
    decision,
  }: {
    decision: AuthzDecision;
  }): Promise<string[]> {
    const grants = await this.collectCached({
      principal: decision.principal,
      organizationId: scopeOrganizationId(decision.scope),
    });
    return this.engine.explain({ decision, grants });
  }

  /**
   * The ADR-092 §9 ceiling snapshot: an api-key principal's owner, or null
   * for every other principal AND for a service key (one with no owner) -
   * both of which the engine reads as "no ceiling".
   */
  private async ownerGrantsFor({
    principal,
    organizationId,
    reader,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    /** Present when the ceiling must come off the same snapshot as the key's
     *  own grants. Intersecting two heads would let a gate expiry between the
     *  two collections cap a ledger binding list with a legacy one. Passing a
     *  reader also means not using the cache, which is the point. */
    reader?: AuthzReadRepository;
  }): Promise<CollectedGrants | null> {
    if (principal.type !== "apiKey") return null;
    const owner = await this.collector.findApiKeyOwner({
      apiKeyId: principal.id,
    });
    if (!owner?.userId) return null;
    const ownerPrincipal: AuthzPrincipalRef = {
      type: "user",
      id: owner.userId,
    };
    return reader
      ? this.collector.collectGrants({
          principal: ownerPrincipal,
          organizationId,
          reader,
        })
      : this.collectCached({ principal: ownerPrincipal, organizationId });
  }

  private async resourceGrantsFor(
    scope: AuthzScopeRef,
  ): Promise<readonly ResourceGrant[] | undefined> {
    if (scope.type !== "resource") return undefined;
    return this.collector.collectResourceGrants({ scope });
  }

  private demoProjectId(): string | undefined {
    return this.options.demoProjectId?.();
  }

  private cacheEnabled(): boolean {
    return this.options.cacheEnabled?.() ?? false;
  }

  /**
   * Collect grants for a principal, via the epoch cache when the flag is on
   * and the epoch store is reachable. Anonymous collects are constant-empty
   * and touch no storage — nothing to cache, and no id to key on.
   */
  private async collectCached({
    principal,
    organizationId,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
  }): Promise<CollectedGrants> {
    const { epochReader } = this.options;
    if (
      !this.cacheEnabled() ||
      !epochReader ||
      principal.type === "anonymous"
    ) {
      return this.collector.collectGrants({ principal, organizationId });
    }

    const epoch = await epochReader({ organizationId });
    if (epoch === null) {
      return this.collector.collectGrants({ principal, organizationId });
    }

    const maxAgeMs = this.options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
    const key = `${principal.type}:${principal.id}:${organizationId}`;
    const entry = this.cache.get(key);
    // The epoch is the correctness bound and the age is the safety net: an
    // epoch that stops advancing (a wedged or silently-reset store) would
    // otherwise pin this snapshot for the process's whole life.
    if (
      entry &&
      entry.epoch === epoch &&
      Date.now() - entry.storedAt < maxAgeMs
    ) {
      return entry.grants;
    }

    const grants = await this.collector.collectGrants({
      principal,
      organizationId,
    });
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      // Plain FIFO eviction: authz entries are tiny and refresh cheaply, so
      // a smarter LRU buys nothing worth its bookkeeping.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { epoch, grants, storedAt: Date.now() });
    return grants;
  }
}

/**
 * ADR-092 §6 step RECORD, as far as it goes today: one structured line per
 * DENY, carrying the five facts a mismatch investigation starts from. Allows
 * are deliberately not logged - the volume only pays for itself once there
 * is a decision store behind it, which lands with the A4 dashboard.
 */
function recordDenial(decision: AuthzDecision): void {
  if (decision.allowed) return;
  decisions.info(
    {
      principalType: decision.principal.type,
      principalId:
        decision.principal.type === "anonymous"
          ? undefined
          : decision.principal.id,
      permission: decision.permission,
      scopeType: decision.scope.type,
      scopeId: decision.scope.id,
      denialReason: decision.denialReason,
    },
    "authz decision denied",
  );
}

/**
 * ADR-092 §11 — the checking API, a service over the collector. The app
 * builds ONE instance in its composition root
 * (platform/app/src/server/authz/runtime.ts) and everything asks it:
 *
 *   authz.can({ principal, permission: "prompts:update", scope })
 *   authz.authorize({ ... })            → Authorized witness, or throws
 *   authz.check({ ... })                → full AuthzDecision, never throws
 *   authz.effectivePermissions({ ... }) → string[] (feeds useCan)
 *
 * The §12 L1 epoch cache lives inside the instance: an entry is valid only
 * while its organization's epoch is unchanged, so a revoked binding is dead
 * on the caller's next request (the grant write bumps the epoch). No epoch
 * reader wired, epoch store down, or flag off all mean the same thing - no
 * caching, always correct, just slower.
 */
import {
  ALL_PERMISSIONS,
  type Authorized,
  AuthzEngine,
  type AuthzDecision,
  type AuthzPermission,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
  mintWitness,
  PermissionDeniedError,
  type ResourceGrant,
  scopeOrganizationId,
} from "@langwatch/authz";
import type { AuthzCollectorService } from "./authz-collector.service";

/** The app's redis-backed epoch store (src/server/authz/epoch.ts). */
export type AuthzEpochReader = (args: {
  organizationId: string;
}) => Promise<number | null>;

const MAX_CACHE_ENTRIES = 10_000;

type CacheEntry = { epoch: number; grants: CollectedGrants };

type CheckArgs = {
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
};

export type AuthzServiceOptions = {
  /** Omitted = never cache. */
  epochReader?: AuthzEpochReader;
  /** Internal rollout knob (AUTHZ_EPOCH_CACHE); omitted = env read. */
  cacheEnabled?: () => boolean;
  /** Mirrors isDemoProject()'s dynamic env read; injectable for tests. */
  demoProjectId?: () => string | undefined;
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
   * ctx.organizationRole from it).
   */
  async checkDetailed({ principal, permission, scope }: CheckArgs): Promise<{
    decision: AuthzDecision;
    grants: CollectedGrants;
  }> {
    const [grants, resourceGrants] = await Promise.all([
      this.collectCached({
        principal,
        organizationId: scopeOrganizationId(scope),
      }),
      this.resourceGrantsFor(scope),
    ]);
    const decision = this.engine.decide({
      grants,
      permission,
      scope,
      demoProjectId: this.demoProjectId(),
      resourceGrants,
    });
    return { decision, grants };
  }

  async can(args: CheckArgs): Promise<boolean> {
    const decision = await this.check(args);
    return decision.allowed;
  }

  /**
   * Check and throw on denial; on success returns the Authorized witness
   * for the scope, the only proof object repositories following the
   * witness convention accept (ADR-092 §7 L3).
   */
  async authorize<S extends AuthzScopeRef["type"]>(args: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: Extract<AuthzScopeRef, { type: S }>;
  }): Promise<Authorized<S>> {
    const decision = await this.check(args);
    if (!decision.allowed) {
      throw new PermissionDeniedError({
        permission: args.permission,
        scope: args.scope,
        denialReason: decision.denialReason ?? "no-binding",
      });
    }
    return mintWitness({
      scope: args.scope,
      permission: args.permission,
      decision,
    });
  }

  /**
   * The caller's full effective permission set at a scope — the frontend's
   * single source of truth (useCan). Computed by testing the whole registry
   * against one collected snapshot: pure decides over ~126 permissions.
   */
  async effectivePermissions({
    principal,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    scope: AuthzScopeRef;
  }): Promise<AuthzPermission[]> {
    const [grants, resourceGrants] = await Promise.all([
      this.collectCached({
        principal,
        organizationId: scopeOrganizationId(scope),
      }),
      this.resourceGrantsFor(scope),
    ]);
    const demo = this.demoProjectId();
    return ALL_PERMISSIONS.filter(
      (permission) =>
        this.engine.decide({
          grants,
          permission,
          scope,
          demoProjectId: demo,
          resourceGrants,
        }).allowed,
    );
  }

  /**
   * ADR-092 §6 — render the walk for a decision, recollecting the snapshot
   * the decision was made against.
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

  private async resourceGrantsFor(
    scope: AuthzScopeRef,
  ): Promise<readonly ResourceGrant[] | undefined> {
    if (scope.type !== "resource") return undefined;
    return this.collector.collectResourceGrants({ scope });
  }

  private demoProjectId(): string | undefined {
    if (this.options.demoProjectId) return this.options.demoProjectId();
    return process.env.DEMO_PROJECT_ID ?? undefined;
  }

  private cacheEnabled(): boolean {
    if (this.options.cacheEnabled) return this.options.cacheEnabled();
    return (
      process.env.AUTHZ_EPOCH_CACHE === "1" ||
      process.env.AUTHZ_EPOCH_CACHE === "true"
    );
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

    const key = `${principal.type}:${principal.id}:${organizationId}`;
    const entry = this.cache.get(key);
    if (entry && entry.epoch === epoch) {
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
    this.cache.set(key, { epoch, grants });
    return grants;
  }
}

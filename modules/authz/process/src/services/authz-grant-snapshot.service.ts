import {
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
  type ResourceGrant,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";

import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type { AuthzCollectorService } from "./authz-collector.service.ts";

const MAX_CACHE_ENTRIES = 10_000;
const DEFAULT_CACHE_MAX_AGE_MS = 30_000;

type CacheEntry = {
  epoch: number;
  grants: CollectedGrants;
  storedAt: number;
  /** When the earliest expiring binding in `grants` ends. */
  endsAtMs: number;
};

type AuthzGrantSnapshotServiceOptions = {
  epoch?: AuthzEpochRepository;
  cacheEnabled?: () => boolean;
  demoProjectId?: () => string | undefined;
  cacheMaxAgeMs?: number;
};

export class AuthzGrantSnapshotService {
  static create(
    collector: AuthzCollectorService,
    options: AuthzGrantSnapshotServiceOptions,
  ): AuthzGrantSnapshotService {
    return new AuthzGrantSnapshotService(collector, options);
  }

  private readonly cache = new Map<string, CacheEntry>();

  private constructor(
    private readonly collector: AuthzCollectorService,
    private readonly options: AuthzGrantSnapshotServiceOptions,
  ) {}

  findDemoProjectId(): string | undefined {
    return this.options.demoProjectId?.();
  }

  async collectCached({
    principal,
    organizationId,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
  }): Promise<CollectedGrants> {
    const epoch = await this.findServingEpoch({ principal, organizationId });
    if (epoch === null) {
      return this.collector.collectGrants({ principal, organizationId });
    }

    return this.collectAtEpoch({ principal, organizationId, epoch });
  }

  /**
   * The principal's snapshot and, for an api key, its owner's ceiling, read as one: on one
   * epoch when the cache serves, else on ONE storage pass, so a legacy/ledger cutover between
   * the two reads cannot pair a current key with a stale owner that fails to cap it.
   */
  async collectWithOwnerCeiling({
    principal,
    organizationId,
    ceiling = true,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    ceiling?: boolean;
  }): Promise<{ grants: CollectedGrants; ownerGrants: CollectedGrants | null }> {
    const epoch = await this.findServingEpoch({ principal, organizationId });
    const collect =
      epoch === null
        ? this.onePassCollect({ organizationId })
        : (subject: AuthzPrincipalRef) =>
            this.collectAtEpoch({ principal: subject, organizationId, epoch });
    const [grants, ownerGrants] = await Promise.all([
      collect(principal),
      ceiling
        ? this.findOwnerPrincipal({ principal }).then((owner) => (owner ? collect(owner) : null))
        : Promise.resolve(null),
    ]);

    return { grants, ownerGrants };
  }

  async findResourceGrantsFor(scope: AuthzScopeRef): Promise<readonly ResourceGrant[] | undefined> {
    if (scope.type !== "resource") {
      return void 0;
    }

    return this.collector.collectResourceGrants({ scope });
  }

  /** The organization's epoch when the cache may serve this principal, else null. */
  private async findServingEpoch({
    principal,
    organizationId,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
  }): Promise<number | null> {
    const { epoch } = this.options;
    const cacheEnabled = this.options.cacheEnabled?.() ?? false;
    if (!cacheEnabled || !epoch || principal.type === "anonymous") {
      return null;
    }

    return epoch.findEpoch({ organizationId });
  }

  private async collectAtEpoch({
    principal,
    organizationId,
    epoch: currentEpoch,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    epoch: number;
  }): Promise<CollectedGrants> {
    if (principal.type === "anonymous") {
      return this.collector.collectGrants({ principal, organizationId });
    }

    const key = `${principal.type}:${principal.id}:${organizationId}`;
    const entry = this.cache.get(key);
    const maxAgeMs = this.options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
    const nowMs = nowInstant().epochMilliseconds;
    const entryIsCurrent =
      entry &&
      entry.epoch === currentEpoch &&
      nowMs - entry.storedAt < maxAgeMs &&
      nowMs < entry.endsAtMs;
    if (entryIsCurrent) {
      return entry.grants;
    }

    const grants = await this.collector.collectGrants({ principal, organizationId });
    this.pruneCache();
    // An expiring grant ends the entry with it: nothing bumps the epoch when a grant lapses.
    this.cache.set(key, {
      epoch: currentEpoch,
      grants,
      storedAt: nowInstant().epochMilliseconds,
      endsAtMs: Math.min(
        Infinity,
        ...grants.bindings.flatMap((binding) =>
          binding.expiresAtMs != null ? [binding.expiresAtMs] : [],
        ),
      ),
    });

    return grants;
  }

  private onePassCollect({
    organizationId,
  }: {
    organizationId: string;
  }): (subject: AuthzPrincipalRef) => Promise<CollectedGrants> {
    const reader = this.collector.beginPass();

    return (subject) =>
      this.collector.collectGrants({ principal: subject, organizationId, reader });
  }

  private async findOwnerPrincipal({
    principal,
  }: {
    principal: AuthzPrincipalRef;
  }): Promise<AuthzPrincipalRef | null> {
    if (principal.type !== "apiKey") {
      return null;
    }

    const owner = await this.collector.findApiKeyOwner({ apiKeyId: principal.id });

    return owner?.userId ? { type: "user", id: owner.userId } : null;
  }

  private pruneCache(): void {
    if (this.cache.size < MAX_CACHE_ENTRIES) {
      return;
    }

    const oldest = this.cache.keys().next().value;
    if (oldest !== void 0) {
      this.cache.delete(oldest);
    }
  }
}

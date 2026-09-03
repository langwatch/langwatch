import {
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
  type ResourceGrant,
} from "@langwatch/authz-contract";
import type { AuthzEpochPort } from "../ports/authz-epoch.port";
import type { AuthzReadRepository } from "../repositories/authz-read.repository";
import { AuthzCollectorService } from "./authz-collector.service";

const MAX_CACHE_ENTRIES = 10_000;
const DEFAULT_CACHE_MAX_AGE_MS = 30_000;

type CacheEntry = {
  epoch: number;
  grants: CollectedGrants;
  storedAt: number;
};

export type AuthzGrantSnapshotServiceOptions = {
  epoch?: AuthzEpochPort;
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

  tryDemoProjectId(): string | undefined {
    return this.options.demoProjectId?.();
  }

  async collectCached({
    principal,
    organizationId,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
  }): Promise<CollectedGrants> {
    const { epoch } = this.options;
    const cacheEnabled = this.options.cacheEnabled?.() ?? false;
    if (!cacheEnabled || !epoch || principal.type === "anonymous") {
      return this.collector.collectGrants({ principal, organizationId });
    }

    const currentEpoch = await epoch.tryRead({ organizationId });
    if (currentEpoch === null) {
      return this.collector.collectGrants({ principal, organizationId });
    }

    const key = `${principal.type}:${principal.id}:${organizationId}`;
    const entry = this.cache.get(key);
    const maxAgeMs = this.options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
    const entryIsCurrent =
      entry && entry.epoch === currentEpoch && Date.now() - entry.storedAt < maxAgeMs;
    if (entryIsCurrent) {
      return entry.grants;
    }

    const grants = await this.collector.collectGrants({ principal, organizationId });
    this.pruneCache();
    this.cache.set(key, {
      epoch: currentEpoch,
      grants,
      storedAt: Date.now(),
    });

    return grants;
  }

  async tryOwnerGrantsFor({
    principal,
    organizationId,
    reader,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    reader?: AuthzReadRepository;
  }): Promise<CollectedGrants | null> {
    if (principal.type !== "apiKey") {
      return null;
    }

    const owner = await this.collector.tryFindApiKeyOwner({ apiKeyId: principal.id });
    if (!owner?.userId) {
      return null;
    }

    const ownerPrincipal: AuthzPrincipalRef = {
      type: "user",
      id: owner.userId,
    };

    if (reader) {
      return this.collector.collectGrants({
        principal: ownerPrincipal,
        organizationId,
        reader,
      });
    }

    return this.collectCached({ principal: ownerPrincipal, organizationId });
  }

  async tryResourceGrantsFor(scope: AuthzScopeRef): Promise<readonly ResourceGrant[] | undefined> {
    if (scope.type !== "resource") {
      return void 0;
    }

    return this.collector.collectResourceGrants({ scope });
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

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:authz:per-organization-cached-gate");

type CacheEntry = { isOn: boolean; expiresAt: number };
type InFlightEntry = { promise: Promise<boolean>; isStale: boolean };

export const MAX_CACHE_ENTRIES = 5_000;

export type PerOrganizationCachedGateStoreOptions = {
  name: string;
  ttlMs: number;
  now?: () => number;
};

/**
 * Bounded per-organization boolean cache. Cold reads coalesce and an
 * invalidation revokes an in-flight read's right to repopulate the cache.
 */
export class PerOrganizationCachedGateStore {
  private readonly cached = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();

  static create(
    options: PerOrganizationCachedGateStoreOptions,
  ): PerOrganizationCachedGateStore {
    return new PerOrganizationCachedGateStore(options);
  }

  private constructor(
    private readonly options: PerOrganizationCachedGateStoreOptions,
  ) {}

  async get({
    organizationId,
    read,
  }: {
    organizationId: string;
    read: () => Promise<boolean>;
  }): Promise<boolean> {
    const entry = this.cached.get(organizationId);
    if (entry !== undefined) {
      if (this.now() < entry.expiresAt) return entry.isOn;
      this.cached.delete(organizationId);
    }

    const pending = this.inFlight.get(organizationId);
    if (pending !== undefined) return pending.promise;

    const flight: InFlightEntry = {
      isStale: false,
      promise: Promise.resolve(false),
    };
    flight.promise = this.settle({ organizationId, read, flight });
    this.inFlight.set(organizationId, flight);
    try {
      return await flight.promise;
    } finally {
      if (this.inFlight.get(organizationId) === flight) {
        this.inFlight.delete(organizationId);
      }
    }
  }

  invalidate({ organizationId }: { organizationId: string }): void {
    this.cached.delete(organizationId);
    const pending = this.inFlight.get(organizationId);
    if (pending !== undefined) {
      pending.isStale = true;
      this.inFlight.delete(organizationId);
    }
  }

  resetForTesting(): void {
    this.cached.clear();
    this.inFlight.clear();
  }

  private async settle({
    organizationId,
    read,
    flight,
  }: {
    organizationId: string;
    read: () => Promise<boolean>;
    flight: InFlightEntry;
  }): Promise<boolean> {
    let isOn = false;
    try {
      isOn = await read();
    } catch (error) {
      logger.warn(
        { organizationId, gate: this.options.name, error },
        "could not read the per-organization gate; caching the failure briefly and answering false",
      );
    }
    if (flight.isStale) return isOn;
    if (this.cached.size >= MAX_CACHE_ENTRIES) this.evictUntilUnderCap();
    this.cached.set(organizationId, {
      isOn,
      expiresAt: this.now() + this.options.ttlMs,
    });
    return isOn;
  }

  private evictUntilUnderCap(): void {
    const now = this.now();
    for (const [key, entry] of this.cached) {
      if (entry.expiresAt <= now) this.cached.delete(key);
    }
    while (this.cached.size >= MAX_CACHE_ENTRIES) {
      const oldestKey: string | undefined = this.cached.keys().next().value;
      if (oldestKey === undefined) break;
      this.cached.delete(oldestKey);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

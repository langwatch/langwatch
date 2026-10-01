// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { nowInstant } from "@langwatch/time";

/** A minute: a stale minute costs a minute of writes; a read per fold costs the hot path. */
export const SNAPSHOT_TTL_MS = 60_000;

/** What one refresh reads: which digests are suppressed, and which organization owns a tenant. */
export interface SuppressionSnapshotData {
  digestsByOrganization: Map<string, Set<string>>;
  organizationByTenant: Map<string, string>;
}

export type SuppressionSnapshotLoader = () => Promise<SuppressionSnapshotData>;

/**
 * The suppression list as the synchronous fold can read it: serves what it holds, refreshes
 * after a TTL, and fails open on a load error. The erasure refreshes the same instance before
 * its replay, so the replay cannot re-derive what it erased (ADR-128 §9 step 5).
 */
export class SuppressionSnapshotService {
  private data: SuppressionSnapshotData = {
    digestsByOrganization: new Map(),
    organizationByTenant: new Map(),
  };
  private loadedAtMs = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<void> | undefined;

  private constructor(
    private readonly load: SuppressionSnapshotLoader,
    private readonly now: () => number,
    private readonly ttlMs: number,
  ) {}

  static create({
    load,
    now = () => nowInstant().epochMilliseconds,
    ttlMs = SNAPSHOT_TTL_MS,
  }: {
    load: SuppressionSnapshotLoader;
    now?: () => number;
    ttlMs?: number;
  }): SuppressionSnapshotService {
    return new SuppressionSnapshotService(load, now, ttlMs);
  }

  /** Organization-wide on purpose: the fold substitutes rather than drops, so over-matching is free. */
  isSuppressedForTenant({
    tenantId,
    identifierHash,
  }: {
    tenantId: string;
    identifierHash: string;
  }): boolean {
    this.refreshIfStale();
    const organizationId = this.data.organizationByTenant.get(tenantId);
    if (!organizationId) return false;
    return this.data.digestsByOrganization.get(organizationId)?.has(identifierHash) ?? false;
  }

  /** Asked first, so the common answer — nobody erased — costs two lookups, not a hash per event. */
  hasAnySuppressionForTenant(tenantId: string): boolean {
    this.refreshIfStale();
    const organizationId = this.data.organizationByTenant.get(tenantId);
    if (!organizationId) return false;
    const digests = this.data.digestsByOrganization.get(organizationId);
    return digests !== undefined && digests.size > 0;
  }

  get isLoaded(): boolean {
    return this.loadedAtMs > Number.NEGATIVE_INFINITY;
  }

  /** Reads the list now and waits: the erasure's step between recording rows and replaying. */
  async refreshNow(): Promise<void> {
    this.inFlight = undefined;
    await this.startRefresh();
  }

  private refreshIfStale(): void {
    if (this.now() - this.loadedAtMs < this.ttlMs) return;
    if (this.inFlight) return;
    void this.startRefresh();
  }

  private startRefresh(): Promise<void> {
    const run = this.load()
      .then((data) => {
        this.data = data;
        this.loadedAtMs = this.now();
      })
      .catch(() => {
        // Fail open, and mark the attempt so a hard-down Postgres is not retried per fold.
        this.loadedAtMs = this.now();
      })
      .finally(() => {
        if (this.inFlight === run) this.inFlight = undefined;
      });
    this.inFlight = run;
    return run;
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The suppression list as the fold can actually read it: synchronously.
 *
 * ADR-128 §9 step 5 requires the fold to pseudonymize an erased identifier
 * BEFORE writing a rollup row — otherwise a replay re-derives the original from
 * the raw event log and inserts it beside the pseudonymized row, duplicating
 * the amount. But the fold's dimension tuple is computed by a synchronous
 * function (it is also the routing key the executor needs before the fold
 * runs), and the suppression list lives in Postgres. A synchronous read of an
 * asynchronous table means a snapshot.
 *
 * So: an immutable snapshot answers instantly, and goes stale on a bounded
 * clock. When a lookup finds the snapshot older than {@link SNAPSHOT_TTL_MS} it
 * serves the answer it has and kicks off a refresh for the next caller. No
 * lifecycle to wire, no timer to leak, and a pod that never folds a governance
 * event never loads the table at all.
 *
 * What that costs, stated plainly: a newly erased identifier can be written
 * once more by any process whose snapshot has not refreshed yet, for at most
 * one TTL. The erasure flow closes this for the operation that matters by
 * refreshing in-process before its delete-then-replay, so the replay it runs
 * never re-derives the original. Another pod folding live traffic in the same
 * window is the residual gap.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */

/**
 * How long a snapshot is served before a lookup asks for a fresh one.
 *
 * A minute, because the two directions cost differently. Serving a stale
 * snapshot for a minute means at most a minute of an erased identifier still
 * being written; re-reading the table on every fold would put a Postgres round
 * trip on the money pipeline's hot path. The list is append-only and tiny —
 * digests of erased identifiers, not a table that grows with traffic — so the
 * refresh itself is one small scan.
 */
export const SNAPSHOT_TTL_MS = 60_000;

/** What one refresh reads: which digests are suppressed, and under which org. */
export interface SuppressionSnapshotData {
  /** `organizationId` → the digests erased anywhere in that organization. */
  digestsByOrganization: Map<string, Set<string>>;
  /** `tenantId` → the organization that wrote governance rows under it. */
  organizationByTenant: Map<string, string>;
}

/** A snapshot holding nothing — what every process answers with until it reads. */
export function emptySuppressionSnapshot(): SuppressionSnapshotData {
  return {
    digestsByOrganization: new Map(),
    organizationByTenant: new Map(),
  };
}

/**
 * Loads the whole suppression picture in one pass. Injected rather than
 * imported so a test states the rows it is reasoning about, and so this module
 * carries no dependency on Prisma.
 */
export type SuppressionSnapshotLoader = () => Promise<SuppressionSnapshotData>;

/**
 * A synchronously readable, self-refreshing view of the suppression list.
 *
 * Deliberately not a general cache: it answers exactly the two questions the
 * erasure design asks, and it fails open on a load error. Failing open is the
 * right way round here — a refusal to fold would stop the money pipeline over a
 * transient Postgres blip, while a missed pseudonymization is corrected by the
 * next fold or the next replay once the load succeeds.
 */
export class SuppressionSnapshot {
  private data: SuppressionSnapshotData = emptySuppressionSnapshot();
  private loadedAtMs = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly load: SuppressionSnapshotLoader,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = SNAPSHOT_TTL_MS,
  ) {}

  /**
   * Whether this digest belongs to somebody erased in the organization that
   * owns this tenant.
   *
   * Organization-wide rather than scoped to one provider, unlike the import
   * paths, and the asymmetry is deliberate. On an import path, matching too
   * broadly would DROP a live person's data — so that check stays scoped to the
   * provider the erasure named. Here the row is not dropped: it is written
   * under a stable pseudonym with its money intact, so a broad match costs
   * nothing and a narrow miss leaves an erased identifier sitting in a money
   * table. The two failure modes are not symmetric, so the two checks are not
   * either.
   *
   * Returns false for an unknown tenant, which is the honest answer: a tenant
   * with no recorded history has no organization to resolve suppression
   * against.
   */
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
    return (
      this.data.digestsByOrganization
        .get(organizationId)
        ?.has(identifierHash) ?? false
    );
  }

  /**
   * Whether anyone has been erased in the organization owning this tenant.
   *
   * The fold asks this first so the overwhelmingly common answer — nobody has
   * — costs two map lookups instead of a SHA-256 per event. Hashing every
   * actor id on every money event to discover that no organization on the
   * deployment has ever erased anybody is work with a knowable answer.
   */
  hasAnySuppressionForTenant(tenantId: string): boolean {
    this.refreshIfStale();
    const organizationId = this.data.organizationByTenant.get(tenantId);
    if (!organizationId) return false;
    const digests = this.data.digestsByOrganization.get(organizationId);
    return digests !== undefined && digests.size > 0;
  }

  /** Whether this process has ever successfully read the list. */
  get isLoaded(): boolean {
    return this.loadedAtMs > Number.NEGATIVE_INFINITY;
  }

  /**
   * Reads the list now and waits for it. Called by the erasure flow between
   * writing the suppression rows and replaying, so the replay it triggers
   * cannot re-derive the identifier it just erased.
   */
  async refreshNow(): Promise<void> {
    this.inFlight = null;
    await this.startRefresh();
  }

  /** Serves what it has; asks for more only when what it has has expired. */
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
        // Fail open, and mark the attempt so a hard-down Postgres does not turn
        // every fold into a new connection attempt. The next lookup after the
        // TTL tries again.
        this.loadedAtMs = this.now();
      })
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }
}

/**
 * The process-wide snapshot the fold reads.
 *
 * A module singleton rather than a constructor argument because the fold's
 * dimension function is reached through a static routing key, with no
 * composition root between it and the executor. Starts empty, which means a
 * process that never installs one behaves exactly as it did before this
 * existed.
 *
 * There is exactly one of these per process, and it is not possible to have
 * two. That is load-bearing rather than tidy: the erasure flow refreshes the
 * list and then triggers a replay that the fold serves, so if the object the
 * erasure refreshed were ever a different object from the one the fold reads,
 * the replay would re-derive the identifier the erasure had just removed and
 * write it straight back — silently, and with the erasure reporting success.
 * Hence {@link installSuppressionSnapshot} takes a loader and constructs the
 * instance itself: there is no way to hand a foreign instance to anything,
 * because nothing accepts one.
 */
let installed: SuppressionSnapshot | null = null;

/**
 * Installs the process's snapshot, replacing any previous one.
 *
 * Takes the loader rather than a constructed snapshot so that the installed
 * instance is the only instance anything can reach. Returns it so the caller
 * can await a first load; nothing else should hold the reference.
 */
export function installSuppressionSnapshot({
  load,
  now,
  ttlMs,
}: {
  load: SuppressionSnapshotLoader;
  now?: () => number;
  ttlMs?: number;
}): SuppressionSnapshot {
  installed = new SuppressionSnapshot(load, now, ttlMs);
  return installed;
}

/** Removes it again — for tests, which must not leak one into the next file. */
export function clearSuppressionSnapshot(): void {
  installed = null;
}

/** The installed snapshot, or null where none was ever installed. */
export function currentSuppressionSnapshot(): SuppressionSnapshot | null {
  return installed;
}

/**
 * Reads the list now, into the snapshot the fold reads.
 *
 * The erasure flow's one refresh entry point. It deliberately names no object:
 * the whole point is that the erasure cannot refresh anything other than what
 * the fold consults. A no-op where nothing is installed, which is a process
 * that also does not fold.
 */
export async function refreshInstalledSuppressionSnapshot(): Promise<void> {
  await installed?.refreshNow();
}

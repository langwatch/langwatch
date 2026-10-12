/**
 * ADR-144 decision 9: any read of an aggregate project is audited, one row
 * per actor and aggregate per five minutes, the way an admin's drill-in to
 * another user's workspace is.
 *
 * Core defines the port; the enterprise governance module writes the row
 * (`ee/governance/services/aggregateReadAudit.ts`), and the App is handed
 * that adapter at composition. Without it the port is the null one and an
 * aggregate read is simply not audited, which is also what a deployment
 * without the governance module gets.
 *
 * The audit fires from the permission middleware where the read's proof is
 * minted, so it covers a deep link, a prefetch and a direct tRPC call as
 * well as a rendered page.
 */

/** One read of an aggregate: who, in which organisation, of which aggregate.
 *  Never the member read or the trace opened. */
export type AggregateRead = {
  actorUserId: string;
  organizationId: string;
  aggregateProjectId: string;
};

export interface AggregateReadAudit {
  recordAggregateRead(read: AggregateRead): Promise<void>;
}

/** The port when no audit is wired: records nothing. */
export const NULL_AGGREGATE_READ_AUDIT: AggregateReadAudit = {
  recordAggregateRead: async () => undefined,
};

/** Bound on remembered pairs; only caps memory, the window does the rest. */
const MAX_REMEMBERED_READS = 10_000;

/**
 * The audit with a per-process window in front: the second read of the same
 * aggregate by the same actor inside the window makes no call at all, and
 * reads arriving together (one page's batch of queries) share one call. The
 * database dedup stays the guard across processes.
 *
 * A failed record is passed on and not remembered, so the next read retries:
 * an outage must cost a later row, never a missing one.
 *
 * Not the per-subject cached gate: that caches a failed read as a negative
 * answer for its whole TTL, which here would skip the audit for five minutes
 * after a database blip.
 */
export class DedupedAggregateReadAudit implements AggregateReadAudit {
  private readonly inner: AggregateReadAudit;
  private readonly windowMs: number;
  private readonly now: () => number;
  /** Pair key to the time its window closes. */
  private readonly recorded = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor({
    inner,
    windowMs,
    now = Date.now,
  }: {
    inner: AggregateReadAudit;
    windowMs: number;
    /** Epoch milliseconds; the audit row's clock, so the two windows agree. */
    now?: () => number;
  }) {
    this.inner = inner;
    this.windowMs = windowMs;
    this.now = now;
  }

  async recordAggregateRead(read: AggregateRead): Promise<void> {
    const key = `${read.actorUserId}\u0000${read.aggregateProjectId}`;
    const closesAt = this.recorded.get(key);
    if (closesAt !== undefined) {
      if (this.now() < closesAt) return;
      this.recorded.delete(key);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const flight = this.inner
      .recordAggregateRead(read)
      .then(() => this.remember(key))
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, flight);
    return flight;
  }

  private remember(key: string): void {
    if (this.recorded.size >= MAX_REMEMBERED_READS) {
      const oldest = this.recorded.keys().next().value;
      if (oldest !== undefined) this.recorded.delete(oldest);
    }
    this.recorded.set(key, this.now() + this.windowMs);
  }
}

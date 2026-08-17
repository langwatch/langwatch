/**
 * How far back a read of a time-partitioned table has to look.
 *
 * Every retention-managed table is partitioned on its time column, so a query
 * with no lower bound prunes nothing and walks every partition — including the
 * cold ones on object storage. That is the difference between a keyed seek and
 * a scan of the entire history, and in production it was the single largest
 * source of cold-scan queries: 208 of 300 in one sampled window.
 *
 * A floor is safe where an unbounded scan is merely expensive: rows older than
 * the tenant's retention are TTL'd away, so a bounded query cannot hide a row
 * the unbounded one would have found.
 *
 * The retention POLICY lives with whoever owns it — this package knows only
 * that some provider can answer "how many days for this tenant and table".
 * That keeps the mechanism here, dependency-free, and reusable by any caller
 * that can answer the question.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default slack added below the retention horizon.
 *
 * TTL deletion is asynchronous — a row past its retention is eligible for
 * removal, not already gone — and the floor is compared against a column whose
 * clock is the producer's, not ours. Two days covers both without meaningfully
 * widening the partition range.
 */
export const DEFAULT_RETENTION_FLOOR_MARGIN_MS = 2 * DAY_MS;

/** Answers the retention question this package deliberately does not own. */
export interface RetentionDaysProvider {
  /**
   * Retention in days for this tenant's copy of `table`, or null when the
   * policy cascade cannot answer.
   */
  getRetentionDays(input: {
    tenantId: string;
    table: string;
  }): Promise<number | null>;
}

/** The subset of a structured logger this needs; keeps the package dep-free. */
export interface RetentionFloorLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface RetentionFloorServiceOptions {
  /** Used whenever the provider is absent, unhelpful, or throws. */
  defaultRetentionDays: number;
  provider?: RetentionDaysProvider;
  logger?: RetentionFloorLogger;
  marginMs?: number;
  /**
   * How long a resolved retention is reused for.
   *
   * The provider walks a policy cascade, so an uncached lookup would put a
   * database round trip in front of every read this bounds — which is the
   * opposite of the point. Retention changes on human timescales; minutes of
   * staleness only ever shifts a partition bound slightly, and never below
   * `minLookbackMs`.
   */
  cacheTtlMs?: number;
  /**
   * Cap on cached tenants, so a long-lived process serving many projects
   * cannot grow this without bound. Oldest entry is evicted first.
   */
  cacheMaxEntries?: number;
}

/** Five minutes: far below how often retention policy changes. */
export const DEFAULT_RETENTION_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_RETENTION_CACHE_MAX_ENTRIES = 10_000;

export interface RetentionFloorQuery {
  tenantId: string;
  table: string;
  /**
   * A reach the result is never tighter than.
   *
   * For callers replacing an existing hand-picked floor: keeps their previous
   * reach as a guarantee while letting a longer tenant policy widen it, so
   * adopting this can never make a read miss rows it used to find.
   */
  minLookbackMs?: number;
}

export class RetentionFloorService {
  private readonly defaultRetentionDays: number;
  private readonly provider?: RetentionDaysProvider;
  private readonly logger?: RetentionFloorLogger;
  private readonly marginMs: number;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;

  /** Insertion-ordered, which is what makes the oldest entry evictable. */
  private readonly cache = new Map<
    string,
    { days: number; expiresAtMs: number }
  >();

  constructor({
    defaultRetentionDays,
    provider,
    logger,
    marginMs = DEFAULT_RETENTION_FLOOR_MARGIN_MS,
    cacheTtlMs = DEFAULT_RETENTION_CACHE_TTL_MS,
    cacheMaxEntries = DEFAULT_RETENTION_CACHE_MAX_ENTRIES,
  }: RetentionFloorServiceOptions) {
    this.defaultRetentionDays = defaultRetentionDays;
    this.provider = provider;
    this.logger = logger;
    this.marginMs = marginMs;
    this.cacheTtlMs = cacheTtlMs;
    this.cacheMaxEntries = cacheMaxEntries;
  }

  /** The oldest timestamp a read of `table` for `tenantId` can find a row at. */
  async getFloorMs(
    query: RetentionFloorQuery & { nowMs?: number },
  ): Promise<number> {
    const { nowMs = Date.now(), ...rest } = query;
    return nowMs - (await this.getLookbackMs(rest));
  }

  /**
   * The same bound as a duration, for the `{ lookbackMs }` fallback shape a
   * windowed read takes.
   */
  async getLookbackMs({
    tenantId,
    table,
    minLookbackMs = 0,
  }: RetentionFloorQuery): Promise<number> {
    const days = await this.getRetentionDays({ tenantId, table });
    return Math.max(days * DAY_MS + this.marginMs, minLookbackMs);
  }

  /**
   * Resolution failure falls back to the default rather than to an unbounded
   * read: the fallback is a policy question, and "scan everything" is the
   * answer that took production down.
   */
  private async getRetentionDays({
    tenantId,
    table,
  }: {
    tenantId: string;
    table: string;
  }): Promise<number> {
    if (!this.provider) return this.defaultRetentionDays;

    // NUL-joined: neither a tenant id nor a table name can contain it, so two
    // different pairs can never collide on one key.
    const key = `${tenantId}\u0000${table}`;
    const nowMs = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAtMs > nowMs) return hit.days;

    let days: number;
    try {
      const resolved = await this.provider.getRetentionDays({
        tenantId,
        table,
      });
      // A non-positive answer means the cascade could not resolve one, not
      // that the tenant asked for zero-day retention.
      days =
        typeof resolved === "number" && resolved > 0
          ? resolved
          : this.defaultRetentionDays;
    } catch (error) {
      this.logger?.warn(
        { tenantId, table, error },
        "Retention resolve for read floor failed; using the default",
      );
      // Cached like any other answer: a cascade that is down would otherwise
      // be re-asked on every read, which is when it can least afford it.
      days = this.defaultRetentionDays;
    }

    this.remember(key, days, nowMs);
    return days;
  }

  private remember(key: string, days: number, nowMs: number): void {
    // Refresh insertion order so an entry being rewritten is not also the
    // next one evicted.
    this.cache.delete(key);
    this.cache.set(key, { days, expiresAtMs: nowMs + this.cacheTtlMs });

    while (this.cache.size > this.cacheMaxEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

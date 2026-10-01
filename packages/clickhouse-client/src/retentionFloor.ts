import { nowInstant } from "@langwatch/time";
/**
 * How far back a read of a time-partitioned table has to look. Unbounded
 * scans every partition including cold object storage — the largest source
 * of cold-scan queries — but a floor is safe since TTL'd rows can't be missed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default slack below the retention horizon. TTL deletion is asynchronous —
 * a row past retention is eligible for removal, not already gone — and the
 * floor compares against the producer's clock, not ours. Two days covers both.
 */
export const DEFAULT_RETENTION_FLOOR_MARGIN_MS = 2 * DAY_MS;

/** Answers the retention question this package deliberately does not own. */
export interface RetentionDaysProvider {
  /**
   * Retention in days for this tenant's copy of `table`, or none when the
   * policy cascade cannot answer.
   */
  findRetentionDays: (input: { tenantId: string; table: string }) => Promise<number[]>;
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
   * How long a resolved retention is reused. Uncached, every bounded read
   * would cost a policy-cascade round trip — the opposite of the point.
   * Retention changes on human timescales, so staleness never drops below `minLookbackMs`.
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
   * A reach the result is never tighter than. For callers replacing a
   * hand-picked floor: keeps that reach as a guarantee while letting a
   * longer tenant policy widen it, so adopting this can't make a read miss rows.
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
  private readonly cache = new Map<string, { days: number; expiresAtMs: number }>();

  /**
   * One provider call per key at a time; later arrivals await the first,
   * since the cache writes only once the provider answers. Otherwise a
   * worker fleet sweeping at the same moment fans out to one cascade query per read.
   */
  private readonly inFlight = new Map<string, Promise<number>>();

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
  async getFloorMs(query: RetentionFloorQuery & { nowMs?: number }): Promise<number> {
    const { nowMs = nowInstant().epochMilliseconds, ...rest } = query;
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
    const nowMs = nowInstant().epochMilliseconds;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAtMs > nowMs) return hit.days;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const lookup = this.resolveAndRemember({
      key,
      tenantId,
      table,
      nowMs,
      provider: this.provider,
    });
    this.inFlight.set(key, lookup);
    try {
      return await lookup;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Resolves one key and writes it to the cache. Never rejects — the
   * provider's failure is absorbed into the default below, so every waiter
   * sharing an in-flight promise gets an answer, not an error.
   */
  private async resolveAndRemember({
    key,
    tenantId,
    table,
    nowMs,
    provider,
  }: {
    key: string;
    tenantId: string;
    table: string;
    nowMs: number;
    provider: RetentionDaysProvider;
  }): Promise<number> {
    let days: number;
    try {
      const [resolved] = await provider.findRetentionDays({
        tenantId,
        table,
      });
      // A non-positive answer means the cascade could not resolve one, not
      // that the tenant asked for zero-day retention. Infinity is excluded
      // explicitly: it passes `> 0`, and would render a lookback that turns
      // the floor into an invalid ClickHouse timestamp parameter — an
      // unbounded read by another name, which is what this exists to stop.
      days =
        typeof resolved === "number" && Number.isFinite(resolved) && resolved > 0
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

    this.remember({ key, days, nowMs });
    return days;
  }

  private remember({ key, days, nowMs }: { key: string; days: number; nowMs: number }): void {
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

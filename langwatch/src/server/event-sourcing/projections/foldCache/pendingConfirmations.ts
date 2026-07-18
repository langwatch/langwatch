import type { Redis } from "ioredis";

/**
 * The set of aggregates whose cached fold state is waiting to be confirmed
 * durable.
 *
 * One sorted set per projection, scored by when the entry is next due to be
 * checked. Membership is keyed on `(tenantId, aggregateId)` and deliberately
 * carries no version: a re-registration from a later fold step updates the
 * score in place rather than adding a second member, so an aggregate that is
 * still actively folding keeps pushing its own check further out and is never
 * a candidate. The version to compare against is read from the cache entry at
 * check time, so there is exactly one copy of it and it cannot drift.
 */
export class PendingConfirmations {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
  ) {}

  private setKey(): string {
    return `fold:pending:${this.keyPrefix}`;
  }

  /**
   * Tenant ids and aggregate ids are opaque and may contain any printable
   * character, so the separator is a NUL — written as an escape rather than
   * a literal control byte, which is invisible in source.
   */
  private static readonly SEPARATOR = "\u0000";

  static member(tenantId: string, aggregateId: string): string {
    return `${tenantId}${PendingConfirmations.SEPARATOR}${aggregateId}`;
  }

  static parseMember(
    member: string,
  ): { tenantId: string; aggregateId: string } | null {
    const separator = member.indexOf(PendingConfirmations.SEPARATOR);
    if (separator <= 0 || separator === member.length - 1) return null;
    return {
      tenantId: member.slice(0, separator),
      aggregateId: member.slice(separator + 1),
    };
  }

  /**
   * Schedules an aggregate to be checked at `dueAtMs`. Idempotent — a later
   * call for the same aggregate moves the existing entry rather than adding
   * another.
   */
  async register({
    tenantId,
    aggregateId,
    dueAtMs,
  }: {
    tenantId: string;
    aggregateId: string;
    dueAtMs: number;
  }): Promise<void> {
    await this.redis.zadd(
      this.setKey(),
      dueAtMs,
      PendingConfirmations.member(tenantId, aggregateId),
    );
  }

  /** Aggregates due for a check at or before `nowMs`, oldest first. */
  async due({
    nowMs,
    limit,
  }: {
    nowMs: number;
    limit: number;
  }): Promise<Array<{ tenantId: string; aggregateId: string }>> {
    const members = await this.redis.zrangebyscore(
      this.setKey(),
      "-inf",
      nowMs,
      "LIMIT",
      0,
      limit,
    );

    return members
      .map((member) => PendingConfirmations.parseMember(member))
      .filter((parsed): parsed is { tenantId: string; aggregateId: string } =>
        Boolean(parsed),
      );
  }

  /** Drops aggregates whose state is confirmed durable and cache entry released. */
  async settle(
    entries: ReadonlyArray<{ tenantId: string; aggregateId: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.redis.zrem(
      this.setKey(),
      ...entries.map(({ tenantId, aggregateId }) =>
        PendingConfirmations.member(tenantId, aggregateId),
      ),
    );
  }

  /**
   * Pushes unconfirmed aggregates out to a later check.
   *
   * Re-scoring rather than dropping is what makes every failure conservative:
   * a lagging replica, an unreachable node or a slow durable store all end up
   * here, and the cache entry stays put until the check actually succeeds.
   */
  async defer(
    entries: ReadonlyArray<{
      tenantId: string;
      aggregateId: string;
      nextDueAtMs: number;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const { tenantId, aggregateId, nextDueAtMs } of entries) {
      pipeline.zadd(
        this.setKey(),
        nextDueAtMs,
        PendingConfirmations.member(tenantId, aggregateId),
      );
    }
    await pipeline.exec();
  }

  /** Number of aggregates awaiting confirmation, for the depth gauge. */
  async depth(): Promise<number> {
    return await this.redis.zcard(this.setKey());
  }
}

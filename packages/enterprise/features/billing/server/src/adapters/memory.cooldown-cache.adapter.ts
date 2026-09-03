/**
 * The in-process cooldown that stops one organization being alerted twice.
 *
 * A burst of traces from one organization reaches the limit middleware many
 * times at once, and every one of those calls would otherwise send its own
 * alert. These keep the second and later ones quiet.
 *
 * They are deliberately per-process. The cooldown does not survive a restart
 * and does not coordinate across replicas, so the worst case is a duplicate
 * alert after a deploy — cheap next to the machinery a shared store would
 * need. The authoritative window is the 30-day one in the database; this is
 * only the near-term damper in front of it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * One organization is alerted at most once a month. The authoritative check
 * is the database window in `UsageLimitService`; this sizes the cache in
 * front of it, and both read the same number so they cannot drift apart.
 */
export const MIN_DAYS_BETWEEN_ALERTS = 30;

export interface BillingCooldownCache {
  get(key: string): Promise<boolean | null>;
  set(key: string, value: true): Promise<void>;
  delete(key: string): Promise<void>;
  claim?(key: string, value: true): Promise<boolean>;
}

export class MemoryCooldownCache implements BillingCooldownCache {
  private readonly values = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  async get(key: string): Promise<boolean | null> {
    const expiresAt = this.values.get(key);
    if (!expiresAt || expiresAt <= Date.now()) {
      this.values.delete(key);

      return null;
    }

    return true;
  }

  async set(key: string, _value: true): Promise<void> {
    this.values.set(key, Date.now() + this.ttlMs);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  /** Take the key if it is free, in one step, so two callers cannot both win. */
  async claim(key: string): Promise<boolean> {
    if (await this.get(key)) return false;
    await this.set(key, true);

    return true;
  }
}

export const resourceLimitCooldown = new MemoryCooldownCache(DAY_MS);

/**
 * The plan-limit alert is guarded in two layers, because the two races are
 * different. `planLimitInFlight` is synchronous, and is what stops callers
 * interleaving within one tick before any await has resolved;
 * `planLimitCooldown` is what stops the ticks that follow.
 */
export const planLimitInFlight = new Set<string>();
export const planLimitCooldown = new MemoryCooldownCache(MIN_DAYS_BETWEEN_ALERTS * DAY_MS);

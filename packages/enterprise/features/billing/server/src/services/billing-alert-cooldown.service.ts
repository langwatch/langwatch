/**
 * The in-process cooldown stopping one organization being alerted twice
 * during a burst. Deliberately per-process. The database's 30-day window is
 * authoritative; this is only the near-term damper.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * One organization is alerted at most once a month. The authoritative check
 * is the database window in `UsageLimitService`; this sizes the cache in
 * front of it, and both read the same number so they cannot drift apart.
 */
export const MIN_DAYS_BETWEEN_ALERTS = 30;

export interface BillingCooldownCache {
  tryGet(key: string): Promise<boolean | null>;
  set(key: string, value: true): Promise<void>;
  delete(key: string): Promise<void>;
  claim?(key: string, value: true): Promise<boolean>;
}

export class BillingAlertCooldownService implements BillingCooldownCache {
  static create({ ttlMs }: { ttlMs: number }): BillingAlertCooldownService {
    return new BillingAlertCooldownService(ttlMs);
  }

  private readonly values = new Map<string, number>();

  private constructor(private readonly ttlMs: number) {}

  async tryGet(key: string): Promise<boolean | null> {
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
    if (await this.tryGet(key)) {
      return false;
    }

    await this.set(key, true);

    return true;
  }
}

export const resourceLimitCooldown = BillingAlertCooldownService.create({ ttlMs: DAY_MS });

/**
 * The plan-limit alert is guarded in two layers: `planLimitInFlight` is
 * synchronous and stops callers interleaving within one tick;
 * `planLimitCooldown` stops the ticks that follow.
 */
export const planLimitInFlight = new Set<string>();
export const planLimitCooldown = BillingAlertCooldownService.create({
  ttlMs: MIN_DAYS_BETWEEN_ALERTS * DAY_MS,
});

/**
 * Seed-time data retention: a seeded dev DB keeps its data for two years,
 * partition-aligned, overriding haven's tiny 7-day platform default (which
 * exists so an unseeded worktree stays small).
 *
 * The mechanism is a real org-scoped RetentionPolicy row — the same cascade the
 * product resolves — so ClickHouse writes get TTL = data time + retention days.
 * A backdated seed whose rows would otherwise be stamped with the 7-day default
 * would be written pre-expired, so the seeder pins this first and waits out the
 * resolver's cache window before backdated events flow.
 */
import type { PrismaClient } from "@prisma/client";

/** Weekly partition key (toYearWeek): retention must be a whole number of weeks. */
export const RETENTION_WEEK_DAYS = 7;

/**
 * Two years rounded DOWN to whole weeks: 730 - (730 % 7) = 728 (104 weeks).
 * Just under two years, so the horizon lands on a partition boundary and whole
 * weekly partitions still drop cleanly at the two-year mark.
 */
export const SEEDED_RETENTION_DAYS =
  365 * 2 - ((365 * 2) % RETENTION_WEEK_DAYS);

/** Round a day count UP to the next whole number of weeks. */
export function alignUpToWeeks(days: number): number {
  return Math.ceil(days / RETENTION_WEEK_DAYS) * RETENTION_WEEK_DAYS;
}

/**
 * The retention to pin for a seed covering `windowDays` of backdated history:
 * the two-year floor, or enough whole weeks to outlive the window with a
 * comfortable margin, whichever is larger. Always partition-aligned, so the
 * default 3-month seed gets exactly two years and a multi-year window scales up
 * without ever writing its own oldest rows pre-expired.
 */
export function seededRetentionDays(windowDays: number): number {
  return Math.max(SEEDED_RETENTION_DAYS, alignUpToWeeks(windowDays + 60));
}

/** The categories the retention cascade resolves (retentionPolicy.schema.ts). */
export const RETENTION_CATEGORIES = [
  "traces",
  "scenarios",
  "experiments",
] as const;

export interface ApplySeedRetentionArgs {
  prisma: PrismaClient;
  organizationId: string;
  retentionDays: number;
  /**
   * Sleep out the resolver's 60s cache window after a change, so a running
   * worker restamps with the new horizon before backdated events reach it.
   * Only needed when the seed is backdated (mass) — recent data tolerates the
   * brief window because a stale 7-day stamp still outlives a few minutes.
   */
  waitForCacheRollover?: boolean;
  log?: (message: string) => void;
}

/**
 * Pin every retention category for one organisation to `retentionDays`.
 * Idempotent: a category already at the target is left untouched, and the cache
 * wait only happens when something actually changed. Returns whether any row
 * changed.
 */
export async function applySeedRetention(
  args: ApplySeedRetentionArgs,
): Promise<boolean> {
  const {
    prisma,
    organizationId,
    retentionDays,
    waitForCacheRollover = false,
    log = () => {},
  } = args;
  let changed = false;
  for (const category of RETENTION_CATEGORIES) {
    const where = {
      scopeType_scopeId_category: {
        scopeType: "ORGANIZATION" as const,
        scopeId: organizationId,
        category,
      },
    };
    const existing = await prisma.retentionPolicy.findUnique({ where });
    if (existing && existing.retentionDays === retentionDays) continue;
    await prisma.retentionPolicy.upsert({
      where,
      create: {
        organizationId,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        category,
        retentionDays,
      },
      update: { retentionDays },
    });
    changed = true;
  }
  if (changed && waitForCacheRollover) {
    log(
      `retention pinned to ${retentionDays} days — waiting 65s for the resolver caches to roll over…`,
    );
    await new Promise((resolve) => setTimeout(resolve, 65_000));
  }
  return changed;
}

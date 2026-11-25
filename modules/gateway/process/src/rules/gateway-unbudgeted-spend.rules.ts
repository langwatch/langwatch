/**
 * Which of an organization's keys spent without a budget this week, and what gateway records of
 * it. Pure over the ledger's per-key totals and the keys the sweep listed.
 * Spec: modules/gateway/specs/gateway-governance-events.feature
 */
import {
  nanoUsdToDecimalString,
  NANO_USD_PER_USD,
  type RecordUnbudgetedSpendCommandData,
  UNBUDGETED_SPEND_MAX_KEYS,
  type VirtualKeyPurpose,
} from "@langwatch/gateway-contract";
import { type Instant, Temporal } from "@langwatch/time";

/** Product default: a key's spend over the window at or above $5 is worth a budget. */
export const UNBUDGETED_SPEND_THRESHOLD_NANO_USD = 5 * NANO_USD_PER_USD;

/** Product default: the window is seven UTC days, today included. */
export const UNBUDGETED_SPEND_WINDOW_DAYS = 7;

/** Product default: only a person's own keys count; Langy and Connect keys are the product's. */
export const UNBUDGETED_SPEND_KEY_PURPOSE: VirtualKeyPurpose = "USER";

/** The ISO week an instant falls in, in UTC, `YYYY-Www`. */
function isoWeekOf(at: Instant): string {
  const date = at.toZonedDateTimeISO("UTC").toPlainDate();
  return `${date.yearOfWeek}-W${String(date.weekOfYear).padStart(2, "0")}`;
}

/**
 * Product default: an organization hears of unbudgeted spend at most once a week. The ISO week
 * is the fact's identity: every sweep inside one week records a fact under it, and nurturing
 * sends only the first.
 */
export const UNBUDGETED_SPEND_PERIOD_OF: (at: Instant) => string = isoWeekOf;

/** The ledger window a sweep at `now` reads, and the earliest use that can have spent in it. */
export type UnbudgetedSpendWindow = Readonly<{ fromDay: string; toDay: string; since: Instant }>;

export function unbudgetedSpendWindowAt(now: Instant): UnbudgetedSpendWindow {
  const today = now.toZonedDateTimeISO("UTC").toPlainDate();
  const from = today.subtract({ days: UNBUDGETED_SPEND_WINDOW_DAYS - 1 });
  return {
    fromDay: from.toString(),
    toDay: today.toString(),
    since: Temporal.Instant.from(`${from.toString()}T00:00:00Z`),
  };
}

/** A live person key the sweep listed: what budget resolution and the fact read of it. */
export type UnbudgetedSpendKey = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  principalUserId: string | null;
  traceProjectId: string | null;
}>;

/** One key's spend over the window, as the ledger totals it. */
export type UnbudgetedSpendTotal = Readonly<{ virtualKeyId: string; amountNanoUsd: number }>;

/** A listed key with its window spend. */
export type UnbudgetedSpendCandidate = Readonly<{ key: UnbudgetedSpendKey; amountNanoUsd: number }>;

/**
 * The listed keys whose window spend is at or above the threshold. A total for a key the sweep
 * did not list (another purpose, revoked, disabled) is dropped.
 */
export function keysAtOrOverThreshold({
  totals,
  keys,
}: Readonly<{
  totals: readonly UnbudgetedSpendTotal[];
  keys: readonly UnbudgetedSpendKey[];
}>): UnbudgetedSpendCandidate[] {
  const byId = new Map(keys.map((key) => [key.id, key]));
  return totals.flatMap(({ virtualKeyId, amountNanoUsd }) => {
    const key = byId.get(virtualKeyId);
    return key && amountNanoUsd >= UNBUDGETED_SPEND_THRESHOLD_NANO_USD
      ? [{ key, amountNanoUsd }]
      : [];
  });
}

/**
 * The fact for an organization's unbudgeted keys: the five that spent most, most first and ties
 * by id, with the count and total over all of them.
 */
export function unbudgetedSpendFactOf({
  organizationId,
  unbudgeted,
  now,
}: Readonly<{
  organizationId: string;
  unbudgeted: readonly [UnbudgetedSpendCandidate, ...UnbudgetedSpendCandidate[]];
  now: Instant;
}>): Omit<RecordUnbudgetedSpendCommandData, "tenantId"> {
  const ranked = unbudgeted.toSorted(
    (left, right) =>
      right.amountNanoUsd - left.amountNanoUsd || (left.key.id < right.key.id ? -1 : 1),
  );
  const totalNanoUsd = ranked.reduce((sum, { amountNanoUsd }) => sum + amountNanoUsd, 0);
  return {
    organization_id: organizationId,
    iso_week: UNBUDGETED_SPEND_PERIOD_OF(now),
    keys: ranked.slice(0, UNBUDGETED_SPEND_MAX_KEYS).map(({ key, amountNanoUsd }) => ({
      virtual_key_id: key.id,
      name: key.name,
      spent_usd: nanoUsdToDecimalString(amountNanoUsd),
    })),
    key_count: ranked.length,
    total_spent_usd: nanoUsdToDecimalString(totalNanoUsd),
    occurred_at: now.epochMilliseconds,
  };
}

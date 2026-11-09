/**
 * Which retention an organization's storage is billed by, and the day one measurement covers.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import { GROWTH_INCLUDED_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import {
  BYTES_PER_GB,
  dailyGbMonthShare,
  retentionStorageMeterIdentifier,
} from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The longest retention any of the organization's rules keeps, 0 when one keeps data forever.
 * An organization without rules keeps no more than Growth includes.
 */
export function longestRetentionDays(rules: readonly { retentionDays: number }[]): number {
  if (rules.length === 0) return GROWTH_INCLUDED_RETENTION_DAYS;
  if (rules.some((rule) => rule.retentionDays === 0)) return 0;
  return Math.max(...rules.map((rule) => rule.retentionDays));
}

/** Rows written before this instant are past what Growth includes, so they are billed. */
export function includedRetentionCutoffMs(nowMs: number): number {
  return nowMs - GROWTH_INCLUDED_RETENTION_DAYS * DAY_MS;
}

/** The UTC calendar day an instant falls on, `YYYY-MM-DD`, and how many days its month has. */
export function retentionStorageDayOf(atMs: number): { day: string; daysInMonth: number } {
  const date = Temporal.Instant.fromEpochMilliseconds(atMs).toZonedDateTimeISO("UTC").toPlainDate();
  return { day: date.toString(), daysInMonth: date.daysInMonth };
}

/** What one day's measurement amounts to: the GB kept, its share of a GB-month, its identifier. */
export function retentionStorageMeasurement({
  organizationId,
  bytesAboveIncluded,
  measuredAt,
}: {
  organizationId: string;
  bytesAboveIncluded: number;
  measuredAt: number;
}): { day: string; gbBeyondIncluded: number; dailyShareGb: number; identifier: string } {
  const { day, daysInMonth } = retentionStorageDayOf(measuredAt);
  return {
    day,
    gbBeyondIncluded: bytesAboveIncluded / BYTES_PER_GB,
    dailyShareGb: dailyGbMonthShare({ bytes: bytesAboveIncluded, daysInMonth }),
    identifier: retentionStorageMeterIdentifier({ organizationId, day }),
  };
}

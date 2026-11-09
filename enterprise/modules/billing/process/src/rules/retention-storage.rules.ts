// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The daily storage share billing reports for a retention above 90 days.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import { dailyGbMonthShare } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";

/** Decimal places a share is sent with: a millionth of a GB-month is a fraction of a cent. */
const SHARE_DECIMALS = 6;

/** The UTC calendar day a measurement was taken on, and how many days its month has. */
export function utcDayOf(measuredAtMs: number): { day: string; daysInMonth: number } {
  const date = Temporal.Instant.fromEpochMilliseconds(measuredAtMs)
    .toZonedDateTimeISO("UTC")
    .toPlainDate();
  return { day: date.toString(), daysInMonth: date.daysInMonth };
}

/**
 * The meter value for one day's measurement: the GB stored over the days in that UTC month.
 * The meter sums, so a month measured every day bills its average GB as GB-months; a day the
 * reporter missed bills nothing rather than being guessed.
 */
export function retentionStorageShare({
  bytes,
  measuredAtMs,
}: {
  bytes: number;
  measuredAtMs: number;
}): { share: number; value: string; day: string } {
  const { day, daysInMonth } = utcDayOf(measuredAtMs);
  const share = dailyGbMonthShare({ bytes, daysInMonth });
  return { share, value: share.toFixed(SHARE_DECIMALS), day };
}

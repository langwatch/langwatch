// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The daily storage share billing reports for a retention above 90 days.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import { dailyGbMonthShare, retentionStorageDayOf } from "@langwatch/enterprise-billing-contract";

/** Decimal places a share is sent with: a millionth of a GB-month is a fraction of a cent. */
const SHARE_DECIMALS = 6;

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
  const { day, daysInMonth } = retentionStorageDayOf(measuredAtMs);
  const share = dailyGbMonthShare({ bytes, daysInMonth });
  return { share, value: share.toFixed(SHARE_DECIMALS), day };
}

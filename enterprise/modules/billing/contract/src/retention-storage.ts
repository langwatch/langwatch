// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What data retention tells billing about the storage an organization keeps beyond the
 * retention Growth includes, and what billing did with it.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

const retentionStorageReportSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    /** The longest retention any of the organization's rules keeps; 0 keeps forever. */
    longestRetentionDays: z.number().int().nonnegative(),
    /**
     * The bytes stored in rows older than the included 90 days, measured now. Absent when the
     * retention changed and only the subscription line has to follow it.
     */
    bytesAboveIncluded: z.number().finite().nonnegative().optional(),
    /** When the bytes were measured, in epoch milliseconds; it names the day the share covers. */
    measuredAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export interface RetentionStorageReportSchema extends Named<
  typeof retentionStorageReportSchemaDefinition
> {}
export const retentionStorageReportSchema: RetentionStorageReportSchema =
  retentionStorageReportSchemaDefinition;
export type RetentionStorageReport = z.infer<typeof retentionStorageReportSchema>;

/** What recording one organization's storage did. */
export type RetentionStorageOutcome = Readonly<{
  /** `skipped`: no Growth seat subscription, or the storage price is not provisioned here. */
  line: "added" | "kept" | "removed" | "absent" | "skipped";
  /** The GB-month share sent to the meter, when a measurement was sent. */
  reportedGbMonths: number | null;
}>;

/** Bytes in one GB, as storage is priced. */
export const BYTES_PER_GB = 1_000_000_000;

/**
 * One day's share of a GB-month: the GB stored that day over the days in its month. The meter
 * sums the daily shares, so a month reported every day bills the month's average GB.
 */
export function dailyGbMonthShare({
  bytes,
  daysInMonth,
}: {
  bytes: number;
  daysInMonth: number;
}): number {
  return bytes / BYTES_PER_GB / daysInMonth;
}

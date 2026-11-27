/**
 * Which stored rows the drift check samples and what counts as drift. A few one-hour windows
 * spread over the stored age keep the read to a sliver of each tenant's rows. Pure.
 * Spec: modules/data-retention/specs/retention-drift-check.feature
 */
import { z } from "zod";

const DAY_MS = 86_400_000;
export const RETENTION_DRIFT_WINDOW_MS = 60 * 60 * 1000;

/** Ages sampled, in days; the newest is a day old so a write stamped mid-save is settled. */
const SAMPLE_AGES_DAYS = [1, 3, 7, 14, 30, 60, 90, 180, 365, 730] as const;

export type RetentionDriftWindow = Readonly<{ fromMs: number; toMs: number }>;

export const storedRetentionStampSchema = z.object({
  retentionDays: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
});
export type StoredRetentionStamp = z.infer<typeof storedRetentionStampSchema>;

/** `deferred`: rows kept longer under a shorter save left unapplied; else `unexpected`. */
export const retentionDriftKindSchema = z.enum(["unexpected", "deferred"]);
export type RetentionDriftKind = z.infer<typeof retentionDriftKindSchema>;

export function retentionDriftWindows({ nowMs }: { nowMs: number }): RetentionDriftWindow[] {
  return SAMPLE_AGES_DAYS.map((age) => {
    const toMs = nowMs - age * DAY_MS;
    return { fromMs: toMs - RETENTION_DRIFT_WINDOW_MS, toMs };
  });
}

/** The sampled stamps that differ from the period the project resolves to now. */
export function driftedStamps({
  expectedDays,
  stamps,
}: {
  expectedDays: number;
  stamps: readonly StoredRetentionStamp[];
}): StoredRetentionStamp[] {
  return stamps
    .filter((stamp) => stamp.rows > 0 && stamp.retentionDays !== expectedDays)
    .toSorted((left, right) => left.retentionDays - right.retentionDays);
}

/** Whether a stamp keeps rows longer than the period; 0 keeps forever. */
const keepsLonger = ({ stampDays, periodDays }: { stampDays: number; periodDays: number }) =>
  periodDays !== 0 && (stampDays === 0 || stampDays > periodDays);

/** Deferred only when every drifted stamp keeps rows longer and a shorter save awaits its apply. */
export function retentionDriftKind({
  expectedDays,
  found,
  deferredShortening,
}: {
  expectedDays: number;
  found: readonly StoredRetentionStamp[];
  deferredShortening: boolean;
}): RetentionDriftKind {
  const allLonger = found.every((stamp) =>
    keepsLonger({ stampDays: stamp.retentionDays, periodDays: expectedDays }),
  );
  return deferredShortening && allLonger ? "deferred" : "unexpected";
}

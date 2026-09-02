// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reading the key-to-bill mapping as of a day (ADR-128 §7).
 *
 * The mapping is dated, and this is what makes that worth anything: a chart of
 * last May resolves the bill that covered May, not the bill covering the key
 * today. Everything here is a pure function of periods and a day — no clock, no
 * database — so the same answer comes back however many times May is drawn.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import type { CoveragePeriod } from "../../repositories/ingestionSourceKeyCoverage.repository";

const MS_PER_DAY = 86_400_000;

/**
 * Whether an instant is the start of a UTC day.
 *
 * A day is the finest grain a bill can own — the rollup buckets spend with
 * `toStartOfDay` — so a mid-day effective instant is not representable, and a
 * noon re-point would file the whole day under whichever bill the read happened
 * to resolve.
 */
export function isUtcMidnight(at: Date): boolean {
  return at.getTime() % MS_PER_DAY === 0;
}

/** The UTC midnight that begins a `YYYY-MM-DD` day. */
export function startOfUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Which bill covered each key on one day: key id to ingestion source id.
 *
 * A period covers a day when it began no later than that day's midnight and had
 * not yet ended by it — half-open, so a period ending on the first of June
 * covers May the 31st and not June the 1st, and its successor beginning at the
 * same instant covers June the 1st with no day claimed twice and none left out.
 *
 * A key absent from the returned map is *unmapped* on that day: its gateway
 * spend stands alone as metered, which is a different statement from zero.
 *
 * Throws when two bills both claim a key on one day. The exclusion constraint
 * makes that unreachable, so reaching it means the constraint is missing or
 * something wrote around it — and the alternative, keeping whichever period was
 * read last, is exactly the silent last-writer-wins attribution the constraint
 * exists to prevent. A plain error rather than a named one: nobody reading a
 * chart can act on it.
 */
export function coverageOnDay(params: {
  periods: readonly CoveragePeriod[];
  day: string;
}): Map<string, string> {
  const at = startOfUtcDay(params.day).getTime();
  const covering = new Map<string, string>();
  for (const period of params.periods) {
    if (period.validFrom.getTime() > at) continue;
    if (period.validTo !== null && period.validTo.getTime() <= at) continue;
    const claimed = covering.get(period.virtualKeyId);
    if (claimed !== undefined && claimed !== period.ingestionSourceId) {
      throw new Error(
        `Two ingestion sources cover gateway key ${period.virtualKeyId} on ${params.day}`,
      );
    }
    covering.set(period.virtualKeyId, period.ingestionSourceId);
  }
  return covering;
}

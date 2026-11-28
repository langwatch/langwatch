// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One licence pool, as its newest seat report describes it: counts, never money (the cost is on
 * the invoice the cost lanes read). The four flags travel apart, since a pool can be free,
 * company-wide and suspended at once; which pools count as seats is the caller's decision.
 */
export interface GovernanceSeatReportRow {
  sourceId: string;
  skuPartNumber: string;
  /** `YYYY-MM-DD`, the day the count belongs to. */
  day: string;
  seatsBought: number;
  seatsAssigned: number;
  perPerson: boolean;
  live: boolean;
  free: boolean;
  seatStem: boolean;
}

/** The newest stored seat report of one pool, as both repositories read it. */
export interface StoredSeatReport {
  sourceId: string;
  skuPartNumber: string;
  /** `YYYY-MM-DD`, the day the count belongs to. */
  day: string;
  rawOcsfJson: string;
}

/** The `metadata.extension` bag a pull event's payload carries, or null when unreadable. */
function findOcsfExtension(rawOcsfJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawOcsfJson) as {
      metadata?: { extension?: Record<string, unknown> };
    };
    return parsed.metadata?.extension ?? null;
  } catch {
    return null;
  }
}

/**
 * A count off the payload, or null when it holds no number there. `Number("")` and
 * `Number(null)` are both 0, which would wrongly say the tenant bought no seats.
 */
function findSeatCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

/**
 * One stored seat report as the typed row, or none when its payload cannot be read: zeros would
 * report seats nobody bought. A missing flag reads as false, leaving the pool uncounted.
 */
export function seatReportsOf(row: StoredSeatReport): GovernanceSeatReportRow[] {
  const extension = findOcsfExtension(row.rawOcsfJson);
  if (!extension) return [];

  const seatsBought = findSeatCount(extension.seatsBought);
  const seatsAssigned = findSeatCount(extension.seatsAssigned);
  if (seatsBought === null || seatsAssigned === null) return [];

  const report: GovernanceSeatReportRow = {
    sourceId: row.sourceId,
    skuPartNumber: row.skuPartNumber,
    day: row.day,
    seatsBought,
    seatsAssigned,
    perPerson: extension.perPerson === true,
    live: extension.live === true,
    free: extension.free === true,
    seatStem: extension.seatStem === true,
  };
  return [report];
}

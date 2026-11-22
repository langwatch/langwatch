/** How much of the audit trail an export takes: the view on screen, a preset window, or a range. */

import { currentTimeZone, type Instant, Temporal } from "@langwatch/time";

import { type AuditPeriod, computeAuditWindow } from "./audit-period.ts";

export const AUDIT_EXPORT_RANGES = [
  { key: "view", label: "Current view (filters as shown)" },
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range" },
] as const;

export type AuditExportRangeKey = (typeof AUDIT_EXPORT_RANGES)[number]["key"];

/** Two `yyyy-mm-dd` days, read whole in the reader's zone. */
export type AuditExportCustomRange = { from: string; to: string };

export type AuditExportWindow = { startDate: number; endDate: number };

function dayStart(day: string): number | undefined {
  try {
    return Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: currentTimeZone() })
      .epochMilliseconds;
  } catch {
    return void 0;
  }
}

/**
 * The epoch window an export reads; empty when a custom range is unfinished or runs
 * backwards. "All time" starts at 0, which the read takes as "since the first row".
 */
export function auditExportWindows({
  range,
  view,
  now,
  custom,
}: {
  range: AuditExportRangeKey;
  view: AuditPeriod;
  now: Instant;
  custom: AuditExportCustomRange;
}): AuditExportWindow[] {
  const endDate = now.epochMilliseconds;
  if (range === "view") {
    return [
      { startDate: view.startDate.epochMilliseconds, endDate: view.endDate.epochMilliseconds },
    ];
  }
  if (range === "all") return [{ startDate: 0, endDate }];
  if (range === "custom") {
    const start = dayStart(custom.from);
    const toStart = custom.to ? dayStart(custom.to) : void 0;
    if (start === undefined || toStart === undefined) return [];
    const end = Temporal.Instant.fromEpochMilliseconds(toStart)
      .toZonedDateTimeISO(currentTimeZone())
      .add({ days: 1 }).epochMilliseconds;
    return end > start ? [{ startDate: start, endDate: end - 1 }] : [];
  }

  const window = computeAuditWindow(range, now);
  return [{ startDate: window.startDate.epochMilliseconds, endDate }];
}

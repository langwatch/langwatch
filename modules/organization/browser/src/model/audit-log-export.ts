/**
 * What a downloaded audit report contains, separated from the save (that's
 * `OrganizationHostApi.download`). Uses the same query as the table, so a
 * pre-filtered deep-link never silently widens to the whole organization.
 */

import type { WireOf } from "@langwatch/api/web";
import type { EnrichedAuditLog as StoredEnrichedAuditLog } from "@langwatch/organization-contract";
import { type Instant, toDate } from "@langwatch/time";

import { readableDate } from "./display-formatters.ts";

/** An audit row as the browser receives it: its instant is an ISO string. */
type EnrichedAuditLog = WireOf<StoredEnrichedAuditLog>;

/**
 * CSV-cell cap for the JSON columns (args/before/after): 4 KB is enough for
 * a gateway-shape diff and well under Excel's 32K-character cell limit.
 * `slice` counts UTF-16 units, so non-ASCII can reach ~16 KB — acceptable.
 */
export const CSV_JSON_CAP = 4096;

/**
 * A JSON-shaped value, stringified and capped for a CSV cell. A clipped cell
 * carries an explicit marker so it reads distinctly from an empty value —
 * a blank `after` column would otherwise tell a compliance reviewer nothing changed.
 */
export function truncateJsonForCsv(value: unknown): string {
  if (value == null) return "";
  const rendered = JSON.stringify(value);
  if (rendered === void 0) return "";
  if (rendered.length <= CSV_JSON_CAP) return rendered;
  return `${rendered.slice(0, CSV_JSON_CAP)}…[truncated ${rendered.length - CSV_JSON_CAP} chars]`;
}

/**
 * The report's columns. Source/Target/Before/After mirror the on-screen
 * gateway-shape columns, so a downloaded report carries the same diffs the
 * page shows rather than a narrower legacy shape.
 */
export const AUDIT_LOG_CSV_FIELDS = [
  "Timestamp",
  "Source",
  "User Name",
  "User Email",
  "Action",
  "Target Kind",
  "Target Id",
  "Project",
  "IP Address",
  "User Agent",
  "Error",
  "Args",
  "Before",
  "After",
] as const;

/** One report row, in the column order above. */
export function auditLogCsvRow(log: EnrichedAuditLog): string[] {
  return [
    readableDate(log.createdAt).toISOString(),
    log.source ?? "platform",
    log.user?.name ?? "",
    log.user?.email ?? "",
    log.action,
    log.targetKind ?? "",
    log.targetId ?? "",
    log.project?.name ?? log.projectId ?? "",
    log.ipAddress ?? "",
    log.userAgent ?? "",
    log.error ?? "",
    truncateJsonForCsv(log.args),
    truncateJsonForCsv(log.before),
    truncateJsonForCsv(log.after),
  ];
}

/** The whole report, as the CSV writer takes it. */
export function auditLogCsvTable(logs: readonly EnrichedAuditLog[]): {
  fields: string[];
  data: string[][];
} {
  return {
    fields: [...AUDIT_LOG_CSV_FIELDS],
    data: logs.map(auditLogCsvRow),
  };
}

/** What the saved file is called. Dated so two exports never collide. */
export function auditLogFileName(now: Instant): string {
  return `audit_logs_${toDate(now).toISOString().split("T")[0]}.csv`;
}

/**
 * How many rows a single export request asks for — bigger than a page on
 * purpose, since the export walks the whole filtered history and a 25-row
 * walk over a year of mutations would be thousands of requests.
 */
export const AUDIT_LOG_EXPORT_BATCH_SIZE = 5000;

/**
 * The offsets an export walks, given what the first batch reported — stated
 * as a function so the walk is assertable without a transport. An off-by-one
 * here silently drops the last page, a defect a compliance export cannot afford.
 */
export function auditLogExportOffsets({
  totalCount,
  batchSize = AUDIT_LOG_EXPORT_BATCH_SIZE,
}: {
  totalCount: number;
  batchSize?: number;
}): number[] {
  const offsets: number[] = [];
  for (let offset = batchSize; offset < totalCount; offset += batchSize) {
    offsets.push(offset);
  }
  return offsets;
}

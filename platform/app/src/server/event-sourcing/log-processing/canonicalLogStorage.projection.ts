import { deriveAppendMapping } from "@langwatch/clickhouse";
import { z } from "zod";
import { type CanonicalLogRecord, canonicalLogRecordSchema } from "./schema";
import { logRecordsTable, logUsageEstimatesTable } from "./table";

/** The map's whole job: the event's payload already is the row (ADR-105 decision 5). */
export function toCanonicalLogRecord(
  data: CanonicalLogRecord,
): CanonicalLogRecord {
  return data;
}

/** Mirrors the deployed migration's `_retention_days` column default. */
export const DEFAULT_RETENTION_DAYS = 308;

/**
 * The write stamp is taken once per delivery so every row of one batch reports
 * the same instant, and retention comes from the delivery's resolved policy.
 */
const stampedLogRecordSchema = canonicalLogRecordSchema.extend({
  writtenAt: z.date(),
  dedupVersion: z.bigint(),
  retentionDays: z.number().int().nonnegative(),
});

export type StampedLogRecord = z.infer<typeof stampedLogRecordSchema>;

/**
 * `fill` names the columns the derivation cannot produce: the 64-bit stamps a
 * record carries as decimal strings, and the two columns spelled differently
 * from their field.
 */
export const toLogRecordRow = deriveAppendMapping<
  StampedLogRecord,
  typeof logRecordsTable.columns
>({
  table: logRecordsTable,
  record: stampedLogRecordSchema,
  fill: {
    TimeUnixNano: (record) => BigInt(record.timeUnixNano),
    ObservedTimeUnixNano: (record) => BigInt(record.observedTimeUnixNano),
    _retention_days: (record) => record.retentionDays,
    _size_bytes: (record) => record.canonicalSizeBytes,
  },
});

export const toLogUsageEstimateRow = deriveAppendMapping<
  StampedLogRecord,
  typeof logUsageEstimatesTable.columns
>({
  table: logUsageEstimatesTable,
  record: stampedLogRecordSchema,
  fill: {
    AcceptedHour: (record) => startOfUtcHour(record.acceptedAt),
    CanonicalSourceBytes: (record) => record.canonicalSizeBytes,
  },
});

/** Usage is estimated per whole UTC hour of receipt. */
function startOfUtcHour(epochMs: number): Date {
  const hour = new Date(epochMs);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

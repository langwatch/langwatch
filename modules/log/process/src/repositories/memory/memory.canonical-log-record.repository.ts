import {
  LOG_DEFAULT_READ_LIMIT,
  type CanonicalLogRecord,
  type CanonicalTraceLogRecord,
} from "@langwatch/log-contract";
import { nowInstant } from "@langwatch/time";

import { CanonicalLogRecordRepository } from "../canonical-log-record.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Canonical logs held in memory: one row per tenant and record id, newest acceptance wins. */
export class MemoryCanonicalLogRecordRepository extends CanonicalLogRecordRepository {
  readonly #records = new Map<string, CanonicalLogRecord>();

  private constructor() {
    super();
  }

  static create(): MemoryCanonicalLogRecordRepository {
    return new MemoryCanonicalLogRecordRepository();
  }

  async ensureLogRecord(record: CanonicalLogRecord): Promise<void> {
    const key = `${record.tenantId}:${record.recordId}`;
    const existing = this.#records.get(key);
    if (existing && existing.acceptedAt > record.acceptedAt) return;
    this.#records.set(key, record);
  }

  async ensureLogRecords(records: CanonicalLogRecord[]): Promise<void> {
    for (const record of records) await this.ensureLogRecord(record);
  }

  async findLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit = LOG_DEFAULT_READ_LIMIT,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]> {
    const center =
      typeof occurredAtMs === "number" && occurredAtMs > 0
        ? occurredAtMs
        : nowInstant().epochMilliseconds;
    const from = center - 14 * DAY_MS;
    const to = center + 2 * DAY_MS;

    return [...this.#records.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          record.correlationTraceId === traceId &&
          record.timeUnixMs >= from &&
          record.timeUnixMs <= to,
      )
      .toSorted(
        (a, b) =>
          Number(BigInt(a.timeUnixNano) - BigInt(b.timeUnixNano)) ||
          a.recordId.localeCompare(b.recordId),
      )
      .slice(0, limit)
      .map((record) => {
        const attributes: Record<string, string> = JSON.parse(record.attributesFlatJson);
        if (record.eventName && attributes["event.name"] === undefined) {
          attributes["event.name"] = record.eventName;
        }
        return {
          traceId: record.correlationTraceId,
          spanId: record.correlationSpanId,
          timeUnixMs: record.timeUnixMs,
          body: record.bodyText ?? "",
          attributes,
          resourceAttributes: JSON.parse(record.resourceAttributesFlatJson),
          scopeName: record.scopeName,
          scopeVersion: record.scopeVersion || null,
        };
      });
  }
}

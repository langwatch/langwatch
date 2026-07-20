/**
 * @vitest-environment node
 * @integration
 *
 * Runs the canonical log repository's real INSERT/SELECT SQL against
 * ClickHouse (migration 00050). Everything else in the canonical log pipeline
 * is unit-tested with a mocked client, so this file is what proves:
 * - ensureLogRecords lands rows the marked-Claude-Code read path can find,
 *   filtered to ProviderKind='claude_code' and ordered by time;
 * - re-ensuring the same records does not inflate the marked-record count
 *   (uniqExact(RecordId) is the repository's dedup contract, merge or no merge);
 * - `_size_bytes` stores the record's canonicalSizeBytes (the canonical
 *   payload's UTF-8 byte count), NOT the stored row's byte size — the
 *   deliberate metering deviation;
 * - every accepted record also lands a usage-estimate ledger row.
 *
 * Records are built by the real canonicalisation helper
 * (prepareCanonicalLogRecords), not hand-assembled, so the fixture shape can
 * never drift from what production writes.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prepareCanonicalLogRecords,
  type LogRedactionService,
} from "~/server/event-sourcing/pipelines/log-processing/canonicalLog";
import type { CanonicalLogRecord } from "~/server/event-sourcing/pipelines/log-processing/schemas/logRecord";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { CanonicalLogRecordClickHouseRepository } from "../canonical-log-record.clickhouse.repository";

let ch: ClickHouseClient;
let repo: CanonicalLogRecordClickHouseRepository;

const tag = nanoid();
const tenantId = `${tag}-project`;
const organizationId = `${tag}-org`;

const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";
// Valid wire ids so correlation resolves from the wire, giving every record
// the same CorrelationTraceId the read path queries by.
const traceId = "a1b2c3d4e5f60718a1b2c3d4e5f60718";
const markedSpanA = "1111aaaa2222bbbb";
const markedSpanB = "3333cccc4444dddd";
const unmarkedSpanC = "5555eeee6666ffff";

const noRedaction: LogRedactionService = {
  redactLog: async () => undefined,
};

function otlpLogRecord({
  spanId,
  timeMs,
  eventName,
  body,
}: {
  spanId: string;
  timeMs: number;
  eventName?: string;
  body: string;
}) {
  return {
    traceId,
    spanId,
    timeUnixNano: (BigInt(timeMs) * 1_000_000n).toString(),
    severityNumber: 9,
    severityText: "INFO",
    body: { stringValue: body },
    attributes: eventName
      ? [{ key: "event.name", value: { stringValue: eventName } }]
      : [],
  };
}

/**
 * Two marked Claude Code turn events (the receiver marks `user_prompt` with
 * langwatch.claude_code.kind via claudeCodeLogKind) plus one generic-scope log
 * on the same trace that must never surface from the marked read path.
 * Recent timestamps keep the rows inside the 1-day Claude Code retention TTL.
 */
async function buildRecords(baseMs: number): Promise<CanonicalLogRecord[]> {
  const result = await prepareCanonicalLogRecords({
    tenantId,
    organizationId,
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
    acceptedAt: baseMs,
    request: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "claude-code" } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: CLAUDE_CODE_EVENT_SCOPE, version: "1.0.0" },
              logRecords: [
                otlpLogRecord({
                  spanId: markedSpanA,
                  timeMs: baseMs - 10_000,
                  eventName: "user_prompt",
                  body: "first turn",
                }),
                otlpLogRecord({
                  spanId: markedSpanB,
                  timeMs: baseMs - 5_000,
                  eventName: "user_prompt",
                  body: "second turn",
                }),
              ],
            },
            {
              scope: { name: `${tag}-generic-app` },
              logRecords: [
                otlpLogRecord({
                  spanId: unmarkedSpanC,
                  timeMs: baseMs - 7_500,
                  body: "plain application log",
                }),
              ],
            },
          ],
        },
      ],
    },
  });
  expect(result.errors).toEqual([]);
  expect(result.rejectedLogRecords).toBe(0);
  return result.accepted.map((prepared) => prepared.record);
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new CanonicalLogRecordClickHouseRepository(async () => ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE log_records DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE log_usage_estimates DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("given canonical log records ensured for one trace", () => {
  const baseMs = Date.now();
  let records: CanonicalLogRecord[];

  beforeAll(async () => {
    records = await buildRecords(baseMs);
    expect(records).toHaveLength(3);
    await repo.ensureLogRecords(records);
  }, 30_000);

  describe("when reading marked Claude Code logs by trace", () => {
    it("returns exactly the marked records in time order", async () => {
      const rows = await repo.getMarkedClaudeCodeLogsByTrace({
        tenantId,
        traceId,
        occurredAtMs: baseMs,
      });

      expect(rows.map((row) => row.spanId)).toEqual([markedSpanA, markedSpanB]);
      expect(rows.map((row) => row.traceId)).toEqual([traceId, traceId]);
      expect(rows[0]!.scopeName).toBe(CLAUDE_CODE_EVENT_SCOPE);
      expect(rows[0]!.attributes["langwatch.claude_code.kind"]).toBe("turn");
    });

    it("counts the same marked records", async () => {
      const count = await repo.countMarkedClaudeCodeLogsByTrace({
        tenantId,
        traceId,
        occurredAtMs: baseMs,
      });

      expect(count).toBe(2);
    });
  });

  describe("when the same records are ensured a second time", () => {
    it("does not inflate the marked-record count", async () => {
      await repo.ensureLogRecords(records);

      const count = await repo.countMarkedClaudeCodeLogsByTrace({
        tenantId,
        traceId,
        occurredAtMs: baseMs,
      });

      expect(count).toBe(2);
    });
  });

  describe("when reading back billing metadata", () => {
    it("stores the canonical payload byte size in _size_bytes, not the row size", async () => {
      const marked = records.find(
        (record) => record.correlationSpanId === markedSpanA,
      )!;

      const result = await ch.query({
        query: `
          SELECT _size_bytes
          FROM log_records
          WHERE TenantId = {tenantId:String}
            AND RecordId = {recordId:String}
          LIMIT 1
        `,
        query_params: { tenantId, recordId: marked.recordId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ _size_bytes: number }>();

      expect(rows).toHaveLength(1);
      // The metering deviation: _size_bytes is the canonical payload's
      // original UTF-8 byte count, verbatim from the record.
      expect(Number(rows[0]!._size_bytes)).toBe(marked.canonicalSizeBytes);
      expect(marked.canonicalSizeBytes).toBe(
        Buffer.byteLength(marked.canonicalPayload, "utf8"),
      );
    });

    it("writes a usage-estimate ledger row per accepted record", async () => {
      const result = await ch.query({
        query: `
          SELECT uniqExact(RecordId) AS c
          FROM log_usage_estimates
          WHERE TenantId = {tenantId:String}
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ c: number | string }>();

      expect(Number(rows[0]!.c)).toBe(3);
    });
  });
});

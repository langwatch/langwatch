/**
 * The batched trace-log reads against the migrated schema: one statement per table answers every
 * trace of the batch, each capped at its own row limit.
 * Spec: modules/trace/specs/trace-log-record-read.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LogRecordStorageClickHouseRepository } from "../log-record-storage.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tag = nanoid().toLowerCase();
const tenantId = `${tag}-project`;
const baseMs = Date.now() - 60 * 60 * 1000;
const BIG_TRACE = `${tag}-big`.padEnd(32, "0").slice(0, 32);
const SMALL_TRACE = `${tag}-small`.padEnd(32, "1").slice(0, 32);
const OTHER_TRACE = `${tag}-other`.padEnd(32, "2").slice(0, 32);

let ch: ClickHouseClient;
let repository: LogRecordStorageClickHouseRepository;

function hexId(): string {
  return `${tag}${nanoid()}`
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "0")
    .padEnd(64, "0")
    .slice(0, 64);
}

function logRecordRow({
  traceId,
  body,
  timeMs,
}: {
  traceId: string;
  body: string;
  timeMs: number;
}) {
  return {
    TenantId: tenantId,
    RecordId: hexId(),
    ResourceSchemaUrl: "",
    ResourceAttributesJson: "{}",
    ResourceAttributesFlatJson: "{}",
    ResourceAttributeKeys: [],
    ResourceDroppedAttributesCount: 0,
    ScopeSchemaUrl: "",
    ScopeName: "com.anthropic.claude_code.events",
    ScopeVersion: "1.0.0",
    ScopeAttributesJson: "{}",
    ScopeAttributeKeys: [],
    ScopeDroppedAttributesCount: 0,
    WireTraceId: traceId,
    WireSpanId: "1111aaaa2222bbbb",
    CorrelationTraceId: traceId,
    CorrelationSpanId: "1111aaaa2222bbbb",
    CorrelationSource: "wire",
    TimeUnixNano: String(BigInt(timeMs) * 1_000_000n),
    ObservedTimeUnixNano: String(BigInt(timeMs) * 1_000_000n),
    TimeUnixMs: new Date(timeMs),
    SeverityNumber: 9,
    SeverityText: "INFO",
    BodyType: "string",
    BodyJson: JSON.stringify(body),
    BodyText: body,
    AttributesJson: "{}",
    AttributesFlatJson: JSON.stringify({ "event.name": "user_prompt" }),
    AttributeKeys: ["event.name"],
    DroppedAttributesCount: 0,
    Flags: 0,
    EventName: "user_prompt",
    ProviderKind: "claude_code",
    ProviderEventKind: "",
    ProviderEventSequence: "",
    ProviderSessionId: "",
    ProviderConversationId: "",
    ProviderPromptId: "",
    PiiRedactionLevel: "DISABLED",
    CanonicalPayload: "{}",
    OccurredAt: new Date(timeMs),
    AcceptedAt: new Date(timeMs),
    DedupVersion: String(18_446_744_073_709_551_615n - BigInt(timeMs)),
    _retention_days: 90,
    _size_bytes: body.length,
  };
}

describe.skipIf(!clickHouseConfigured)("LogRecordStorageClickHouseRepository batched reads", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    repository = LogRecordStorageClickHouseRepository.create((async () => ch) as never);
    await ch.insert({
      table: "log_records",
      values: [
        ...Array.from({ length: 5 }, (_, index) =>
          logRecordRow({
            traceId: BIG_TRACE,
            body: `big-${index}`,
            timeMs: baseMs + index * 1_000,
          }),
        ),
        logRecordRow({ traceId: SMALL_TRACE, body: "small-1", timeMs: baseMs + 500 }),
        logRecordRow({ traceId: SMALL_TRACE, body: "small-0", timeMs: baseMs + 100 }),
        logRecordRow({ traceId: OTHER_TRACE, body: "other", timeMs: baseMs }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  });

  afterAll(async () => {
    if (ch) {
      await ch.command({
        query: `ALTER TABLE log_records DELETE WHERE startsWith(TenantId, {tag:String})`,
        query_params: { tag },
      });
    }
  });

  describe("when two traces are read at once with a cap of three rows each", () => {
    /** @scenario "A batch read caps each trace at its own row limit" */
    it("answers the larger trace's oldest three and all of the smaller trace's records", async () => {
      const rows = await repository.findLogRecordsByTraceIds({
        tenantId,
        traces: [
          { traceId: BIG_TRACE, occurredAtMs: baseMs },
          { traceId: SMALL_TRACE, occurredAtMs: baseMs },
        ],
        limitPerTrace: 3,
      });

      const bodiesOf = (traceId: string) =>
        rows.filter((row) => row.traceId === traceId).map((row) => row.body);
      expect(bodiesOf(BIG_TRACE)).toEqual(["big-0", "big-1", "big-2"]);
      expect(bodiesOf(SMALL_TRACE)).toEqual(["small-0", "small-1"]);
      expect(bodiesOf(OTHER_TRACE)).toEqual([]);
    });

    it("answers what the single-trace read answers for each trace", async () => {
      const batched = await repository.findLogRecordsByTraceIds({
        tenantId,
        traces: [{ traceId: SMALL_TRACE, occurredAtMs: baseMs }, { traceId: BIG_TRACE }],
      });
      const single = [
        ...(await repository.findLogRecordsByTraceId({ tenantId, traceId: SMALL_TRACE })),
        ...(await repository.findLogRecordsByTraceId({ tenantId, traceId: BIG_TRACE })),
      ];

      const byKey = (rows: typeof batched) =>
        rows.map((row) => `${row.traceId}:${row.body}`).toSorted();
      expect(byKey(batched)).toEqual(byKey(single));
    });
  });

  describe("when the legacy stored log records hold nothing for the batch", () => {
    it("answers no rows from the one batched statement", async () => {
      const rows = await repository.findLogsByTraceIds({
        tenantId,
        traces: [{ traceId: BIG_TRACE, occurredAtMs: baseMs }, { traceId: SMALL_TRACE }],
      });

      expect(rows).toEqual([]);
    });
  });
});

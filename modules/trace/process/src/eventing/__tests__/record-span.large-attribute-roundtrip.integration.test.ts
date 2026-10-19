/**
 * A large Anthropic content span through the record-span command, the real ClickHouse event_log,
 * the projection lean and the full read that follows its eventrefs back.
 * @see specs/trace-processing/oversized-attribute-value-preview.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  createTenantId,
  EventLogReadSeat,
  type Command,
  type Event as StoredEvent,
} from "@langwatch/eventing";
import {
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  RECORD_SPAN_COMMAND_TYPE,
  TRUNCATED_ATTRIBUTES_KEY,
  type NormalizedSpan,
  type RecordSpanCommandData,
  type SpanReceivedEvent,
} from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  anthropicContentSpan,
  anthropicInputMessages,
} from "../../__tests__/support/anthropic-content-span.fixture.ts";
import { S3TraceLegacySpoolChannel } from "../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { TraceIOExtractionService } from "../../features/derivation/services/trace-io-extraction.service.ts";
import { TraceBlobStoreService } from "../../features/media/services/trace-blob-store.service.ts";
import {
  IO_PREVIEW_BYTES,
  leanForProjection,
} from "../../features/projection/rules/trace-projection-lean.rules.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { EventingTraceEventPayloadRepository } from "../../repositories/eventing/eventing.trace-event-payload.repository.ts";
import {
  MAX_RECORDED_ATTRIBUTE_VALUE_BYTES,
  readTruncatedAttributes,
} from "../../rules/trace-attribute-cap.rules.ts";
import { TraceOffloadResolutionService } from "../../services/trace-offload-resolution.service.ts";
import { EventingRecordSpanAdapter } from "../record-span.commands.ts";

const clickHouseConfigured = testClickHouseConfigured();
const TENANT = `large-attribute-${nanoid()}`;
const MB = 1024 * 1024;

let ch: ClickHouseClient;

/** The eventing port over the test client, without the routing-only request fields. */
function eventingClient(client: ClickHouseClient): EventingClickHouseClient {
  return {
    query: ({ query, query_params, format }) => client.query({ query, query_params, format }),
    insert: ({ table, values, format, clickhouse_settings }) =>
      client.insert({ table, values: [...values], format, clickhouse_settings }),
  };
}

function recorder(): EventingRecordSpanAdapter {
  return EventingRecordSpanAdapter.create({
    piiRedaction: { redact: async () => {} },
    costEnrichment: { enrich: async () => {} },
    tokenEstimation: { estimate: async () => {} },
    contentDrop: { drop: async () => ({ droppedCount: 0, droppedCategories: [] }) },
  });
}

/** Records one span with `inputBytes` of input and appends its event to event_log. */
async function recordAndStore(inputBytes: number): Promise<SpanReceivedEvent> {
  const traceId = nanoid(32);
  const span = anthropicContentSpan({ traceId, spanId: nanoid(16), inputBytes });
  const command: Command<RecordSpanCommandData> = {
    type: RECORD_SPAN_COMMAND_TYPE,
    tenantId: createTenantId(TENANT),
    aggregateId: traceId,
    data: {
      tenantId: TENANT,
      occurredAt: Date.now(),
      span,
      resource: null,
      instrumentationScope: null,
    },
  };
  const [event] = await recorder().handle(command);
  const resolveClient = async () => eventingClient(ch);
  const store = EventingClickHouseEventStore.create({
    repository: EventingClickHouseEventRepository.create({
      resolveClient,
      retention: { defaultRetentionDays: 7 },
    }),
    retention: { defaultRetentionDays: 7 },
  });
  await store.storeEvents([event as StoredEvent], { tenantId: createTenantId(TENANT) }, "trace");
  return event!;
}

/** The leaned span as the projection stores it, in the flat shape the read path receives. */
function projectedSpan(event: SpanReceivedEvent): NormalizedSpan {
  const leaned = leanForProjection(event);
  const spanAttributes: Record<string, string> = {};
  for (const attr of leaned.data.span.attributes) {
    if (typeof attr.value.stringValue === "string")
      spanAttributes[attr.key] = attr.value.stringValue;
  }
  return {
    id: event.data.span.spanId,
    traceId: event.data.span.traceId,
    spanId: event.data.span.spanId,
    tenantId: TENANT,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 0,
    endTimeUnixMs: 4_000,
    durationMs: 4_000,
    name: event.data.span.name,
    kind: NormalizedSpanKind.CLIENT,
    resourceAttributes: {},
    spanAttributes,
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "anthropic", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

/** The full-content read: follows the projected span's eventrefs back into event_log. */
async function fullRead(span: NormalizedSpan): Promise<NormalizedSpan> {
  const blobStore = TraceBlobStoreService.create({
    legacySpool: S3TraceLegacySpoolChannel.create({
      resolveS3Client: async () => {
        throw new Error("no spool storage in this test");
      },
    }),
    payloads: EventingTraceEventPayloadRepository.create({
      eventReadSeat: EventLogReadSeat.create({
        repository: EventingClickHouseEventRepository.createForEventReads({
          resolveClient: async () => eventingClient(ch),
        }),
      }),
    }),
  });
  const { resolvedSpans } = await TraceOffloadResolutionService.create().resolveOffloadedTraces({
    projectId: TENANT,
    normalizedSpans: [span],
    blobStore,
    ioExtractionService: TraceIOExtractionService.create(TraceCanonicalisationService.create()),
    logger: { warn: () => {}, error: () => {} },
  });
  return resolvedSpans[0]!;
}

describe.skipIf(!clickHouseConfigured)("a large Anthropic content span round trip", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
  });

  describe("given a default Anthropic span with 0.75 MB of input messages", () => {
    /** @scenario "A default Anthropic content span is recorded whole" */
    it("keeps a bounded preview in the projection and reads the full input back from event_log", async () => {
      const event = await recordAndStore(0.75 * MB);
      const projected = projectedSpan(event);

      expect(
        Buffer.byteLength(projected.spanAttributes["gen_ai.input.messages"] as string),
      ).toBeLessThanOrEqual(IO_PREVIEW_BYTES);

      const read = await fullRead(projected);

      expect(read.spanAttributes["gen_ai.input.messages"]).toBe(anthropicInputMessages(0.75 * MB));
      expect(read.spanAttributes[TRUNCATED_ATTRIBUTES_KEY]).toBeUndefined();
    });
  });

  describe("given an Anthropic span with a full 1M-token context of about 4 MB", () => {
    /** @scenario "A full 1M-token context span is recorded whole" */
    it("reads the full input back from event_log", async () => {
      const read = await fullRead(projectedSpan(await recordAndStore(4 * MB)));

      expect(read.spanAttributes["gen_ai.input.messages"]).toBe(anthropicInputMessages(4 * MB));
    });
  });

  describe("given a span whose input is over the record cap", () => {
    /** @scenario "A value over the record cap is cut and the span names it" */
    it("reads back the placeholder and a marker naming the cut attribute and its size", async () => {
      const overCap = MAX_RECORDED_ATTRIBUTE_VALUE_BYTES + 1024;

      const read = await fullRead(projectedSpan(await recordAndStore(overCap)));

      expect(read.spanAttributes["gen_ai.input.messages"]).toBe(`[truncated: ${overCap} bytes]`);
      expect(
        readTruncatedAttributes(read.spanAttributes[TRUNCATED_ATTRIBUTES_KEY] as string),
      ).toEqual([{ key: "gen_ai.input.messages", bytes: overCap }]);
    });
  });
});

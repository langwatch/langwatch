/**
 * The edge extraction and the record-span command together: a recording larger than the
 * attribute cap survives as a stored reference.
 * @see specs/trace-processing/trace-media-blob-extraction.feature
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { createTenantId, type Command } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventSchema,
  TRUNCATED_ATTRIBUTES_KEY,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceMediaExtractionService } from "../../features/media/services/trace-media-extraction.service.ts";
import {
  TRACE_CONTENT_MEDIA,
  TraceMediaStoreService,
} from "../../features/media/services/trace-media-store.service.ts";
import { TraceSpanMediaExtractionService } from "../../features/media/services/trace-span-media-extraction.service.ts";
import { MAX_RECORDED_ATTRIBUTE_VALUE_BYTES } from "../../rules/trace-attribute-cap.rules.ts";
import { EventingRecordSpanAdapter } from "../record-span.commands.ts";

type StoreCall = Parameters<StoredObjectApi["storeFromBytes"]>[0];

/** About 9 MiB of base64 once encoded: an mp3 of roughly nine minutes at 96 kbps. */
const RECORDING = Buffer.alloc(7 * 1024 * 1024, 0x5a);
const RECORDING_BASE64 = RECORDING.toString("base64");

function audioSpan(): OtlpSpan {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "Here is the call" },
        { type: "input_audio", input_audio: { data: RECORDING_BASE64, format: "mp3" } },
      ],
    },
  ];
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "voice-call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes: [{ key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } }],
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/** The receiver always sends the default level; the project's policy is resolved downstream. */
function commandData(): RecordSpanCommandData {
  return {
    tenantId: "project-1",
    occurredAt: 1_700_000_000_000,
    span: audioSpan(),
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "ESSENTIAL",
  };
}

async function ingest({ data }: { data: RecordSpanCommandData }): Promise<{
  calls: StoreCall[];
  attributes: Map<string, string | undefined>;
}> {
  const calls: StoreCall[] = [];
  const storedObjects = createApiFixture<StoredObjectApi>(
    {
      storeFromBytes: async (input) => {
        calls.push(input);
        return {
          reference: { id: `so_${calls.length}`, mediaType: input.mediaType } as Awaited<
            ReturnType<StoredObjectApi["storeFromBytes"]>
          >["reference"],
          isDuplicate: false,
        };
      },
    },
    "stored objects",
  );
  const staged = await TraceSpanMediaExtractionService.create({
    extraction: TraceMediaExtractionService.create({
      store: TraceMediaStoreService.create({
        storedObjects,
        purpose: TRACE_CONTENT_MEDIA,
        retention: createApiFixture<DataRetentionApi>({ getRetentionDays: async () => 30 }),
      }),
    }),
    telemetry: { failOpen: () => {} },
    logger: createTestLogger().logger,
  }).extractFromSpan({
    data,
    policy: {
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }, "flags"),
      hasContentDropRules: async () => false,
    },
  });
  const command: Command<RecordSpanCommandData> = {
    type: RECORD_SPAN_COMMAND_TYPE,
    tenantId: createTenantId(staged.tenantId),
    aggregateId: staged.span.traceId,
    data: staged,
  };
  const events = await EventingRecordSpanAdapter.create({
    piiRedaction: { redact: async () => {} },
    costEnrichment: { enrich: async () => {} },
    tokenEstimation: { estimate: async () => {} },
    contentDrop: { drop: async () => ({ droppedCount: 0, droppedCategories: [] }) },
  }).handle(command);
  const event = spanReceivedEventSchema.parse(
    events.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
  );

  return {
    calls,
    attributes: new Map(
      event.data.span.attributes.map((attr) => [attr.key, attr.value.stringValue ?? undefined]),
    ),
  };
}

async function storedBytesOf(call: StoreCall): Promise<number> {
  const bytes = call.bytes;
  if (bytes instanceof Uint8Array) return bytes.byteLength;
  let total = 0;
  for await (const chunk of bytes) total += chunk.byteLength;
  return total;
}

describe("given a span whose inline recording is larger than the attribute cap", () => {
  it("is larger than the cap before extraction", () => {
    expect(RECORDING_BASE64.length).toBeGreaterThan(MAX_RECORDED_ATTRIBUTE_VALUE_BYTES);
  });

  describe("when it is ingested for a project on the default essential PII level", () => {
    /** @scenario "A recording larger than the 8 MiB attribute cap survives ingestion" */
    it("records a stored reference, names no truncation and stores the whole recording", async () => {
      const { calls, attributes } = await ingest({ data: commandData() });

      const input = attributes.get("langwatch.input") ?? "";
      expect(input).not.toContain(RECORDING_BASE64.slice(0, 64));
      expect(input).toContain("so_1");
      expect(attributes.has(TRUNCATED_ATTRIBUTES_KEY)).toBe(false);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ purpose: "trace_content", ownerId: "trace-1" });
      await expect(storedBytesOf(calls[0]!)).resolves.toBe(RECORDING.byteLength);
    });
  });
});

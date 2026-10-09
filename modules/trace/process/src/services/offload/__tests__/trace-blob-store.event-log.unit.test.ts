/**
 * @see ADR-022: the blob store's offloaded-field read through trace's payload reader over a
 * recording event read seat, and the spool's best-effort delete and empty-body refusal.
 */

import {
  createTenantId,
  type Event,
  EventNotFoundError,
  type EventReadSeat,
  EventUtils,
  eventToRecord,
} from "@langwatch/eventing";
import {
  EVENTREF_ATTR_PREFIX,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
  type SpanReceivedEvent,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import {
  type S3ClientResolver,
  S3TraceLegacySpoolChannel,
} from "../../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { TraceIOExtractionService } from "../../../features/derivation/services/trace-io-extraction.service.ts";
import { TraceBlobStoreService } from "../../../features/media/services/trace-blob-store.service.ts";
import { IO_PREVIEW_BYTES } from "../../../features/projection/rules/trace-projection-lean.rules.ts";
import { EventingTraceEventPayloadRepository } from "../../../repositories/eventing/eventing.trace-event-payload.repository.ts";
import { TraceEventPayloadFieldNotFoundError } from "../../../repositories/trace-payload-reader.repository.ts";
import {
  TraceOffloadResolutionService,
  type WarnLogger,
} from "../../trace-offload-resolution.service.ts";

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const AGGREGATE_ID = "trace-001";
const EVENT_ID = "evt-001";
const FIELD = "langwatch.output";
const FULL_VALUE = "x".repeat(100 * 1024);

type SeatRead = Parameters<EventReadSeat["getEvent"]>[0];

/** A seat holding events per tenant and keeping every read it was asked; others are not found. */
class RecordingSeat implements EventReadSeat {
  readonly reads: SeatRead[] = [];
  private readonly events = new Map<string, unknown>();

  store({ tenantId, eventId, data }: { tenantId: string; eventId: string; data: unknown }): this {
    this.events.set(`${tenantId}/${eventId}`, data);
    return this;
  }

  async getEvent(input: SeatRead): Promise<Event> {
    this.reads.push(input);
    const key = `${input.tenantId}/${input.eventId}`;
    if (!this.events.has(key)) throw new EventNotFoundError(input);

    return { id: input.eventId, data: this.events.get(key) } as Event;
  }
}

function makeS3Resolver(s3Client: { send: ReturnType<typeof vi.fn> }): S3ClientResolver {
  return async () => ({ s3Client: s3Client as never, s3Bucket: "test-spool-bucket" });
}

function blobStoreOver(
  seat: RecordingSeat,
  resolveS3Client: S3ClientResolver = makeS3Resolver({ send: vi.fn() }),
): TraceBlobStoreService {
  return TraceBlobStoreService.create({
    legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client }),
    payloads: EventingTraceEventPayloadRepository.create({ eventReadSeat: seat }),
  });
}

/** The payload exactly as the write path stores it, read back through JSON as the seat answers. */
function storedPayloadOf(event: SpanReceivedEvent): unknown {
  return JSON.parse(JSON.stringify(eventToRecord(event).EventPayload));
}

function spanPayload(attributes: unknown[]): unknown {
  return { span: { attributes } };
}

function spanReceivedEvent(attributes: unknown[]): SpanReceivedEvent {
  return EventUtils.createEvent<SpanReceivedEvent>({
    aggregateType: "trace",
    aggregateId: AGGREGATE_ID,
    tenantId: createTenantId(TENANT_A),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: {
        traceId: "abcd1234abcd1234abcd1234abcd1234",
        spanId: "abcd1234abcd1234",
        name: "test-span",
        kind: 1,
        startTimeUnixNano: "0",
        endTimeUnixNano: "1000000",
        attributes: attributes as never,
        events: [],
        links: [],
        status: { message: null, code: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
  });
}

const MIXED_SIBLINGS = [
  { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
  { key: "gen_ai.request.temperature", value: { doubleValue: 0.7 } },
  { key: "langwatch.streaming", value: { boolValue: true } },
  { key: "gen_ai.request.tools", value: { arrayValue: { values: [{ stringValue: "a" }] } } },
];

describe("given a trace event stored under tenantA carrying an offloaded field", () => {
  const seat = () =>
    new RecordingSeat().store({
      tenantId: TENANT_A,
      eventId: EVENT_ID,
      data: spanPayload([{ key: FIELD, value: { stringValue: FULL_VALUE } }]),
    });

  describe("when getFromEventLog is called with tenantA's context", () => {
    /** @scenario Cross-tenant event_log read is structurally denied */
    it("asks the seat for tenantA's trace event and returns the full value", async () => {
      const recording = seat();

      const value = await blobStoreOver(recording).getFromEventLog({
        eventId: EVENT_ID,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateId: AGGREGATE_ID,
      });

      expect(value).toBe(FULL_VALUE);
      expect(recording.reads).toEqual([
        {
          tenantId: TENANT_A,
          aggregateType: "trace",
          aggregateId: AGGREGATE_ID,
          eventId: EVENT_ID,
        },
      ]);
    });
  });

  describe("when tenantB attempts to read it with the same EventId", () => {
    /** @scenario Cross-tenant event_log read is structurally denied */
    it("asks the seat under tenantB, which answers not found", async () => {
      const recording = seat();

      await expect(
        blobStoreOver(recording).getFromEventLog({
          eventId: EVENT_ID,
          field: FIELD,
          tenantId: TENANT_B,
          aggregateId: AGGREGATE_ID,
        }),
      ).rejects.toBeInstanceOf(EventNotFoundError);
      expect(recording.reads.map((read) => read.tenantId)).toEqual([TENANT_B]);
    });
  });

  describe("when the requested field is not in the payload", () => {
    it("raises field-not-found", async () => {
      await expect(
        blobStoreOver(seat()).getFromEventLog({
          eventId: EVENT_ID,
          field: "langwatch.input",
          tenantId: TENANT_A,
          aggregateId: AGGREGATE_ID,
        }),
      ).rejects.toBeInstanceOf(TraceEventPayloadFieldNotFoundError);
    });
  });

  describe("when the deployment has no object storage (resolveS3Client throws)", () => {
    it("reads the field without touching S3", async () => {
      const noStorage: S3ClientResolver = () => {
        throw new Error("no object storage configured");
      };

      const value = await blobStoreOver(seat(), noStorage).getFromEventLog({
        eventId: EVENT_ID,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateId: AGGREGATE_ID,
      });

      expect(value).toBe(FULL_VALUE);
    });
  });
});

describe("given a blob store composed with no payload reader", () => {
  it("refuses the read by name", async () => {
    const store = TraceBlobStoreService.create({
      legacySpool: S3TraceLegacySpoolChannel.create({
        resolveS3Client: makeS3Resolver({ send: vi.fn() }),
      }),
    });

    await expect(
      store.getFromEventLog({
        eventId: EVENT_ID,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateId: AGGREGATE_ID,
      }),
    ).rejects.toThrow(/No trace payload reader configured/);
  });
});

describe("given a log record event whose body was offloaded", () => {
  it("resolves the body from the payload root, not span.attributes", async () => {
    const logBody = "y".repeat(80 * 1024);
    const recording = new RecordingSeat().store({
      tenantId: TENANT_A,
      eventId: EVENT_ID,
      data: { body: logBody },
    });

    await expect(
      blobStoreOver(recording).getFromEventLog({
        eventId: EVENT_ID,
        field: "body",
        tenantId: TENANT_A,
        aggregateId: AGGREGATE_ID,
      }),
    ).resolves.toBe(logBody);
  });

  it("raises field-not-found when the payload has no body", async () => {
    const recording = new RecordingSeat().store({
      tenantId: TENANT_A,
      eventId: EVENT_ID,
      data: spanPayload([]),
    });

    await expect(
      blobStoreOver(recording).getFromEventLog({
        eventId: EVENT_ID,
        field: "body",
        tenantId: TENANT_A,
        aggregateId: AGGREGATE_ID,
      }),
    ).rejects.toBeInstanceOf(TraceEventPayloadFieldNotFoundError);
  });
});

describe("given a transient spool ref", () => {
  describe("when deleteSpool is called", () => {
    it("issues an S3 DELETE and returns void (no error thrown even if S3 DELETE fails)", async () => {
      const sendMock = vi.fn().mockRejectedValue(new Error("S3 DELETE failed"));
      const blobStore = blobStoreOver(new RecordingSeat(), makeS3Resolver({ send: sendMock }));

      await expect(
        blobStore.deleteSpool({
          spoolRef: "trace-blobs/spool/proj/trace-001/span-001",
          projectId: "proj",
          traceId: "trace-001",
          spanId: "span-001",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given an S3 GetObject that returns a response with no Body", () => {
  describe("when getSpool is called", () => {
    it("throws an explicit 'no body' error rather than returning an empty buffer", async () => {
      const sendMock = vi.fn().mockResolvedValue({ Body: undefined });
      const blobStore = blobStoreOver(new RecordingSeat(), makeS3Resolver({ send: sendMock }));

      await expect(
        blobStore.getSpool({
          spoolRef: "trace-blobs/spool/proj/trace-001/span-001",
          projectId: "proj",
          traceId: "trace-001",
          spanId: "span-001",
        }),
      ).rejects.toThrow(/no body/i);
    });
  });
});

/** CONTRACT REGRESSION (#4215): the read path finds the field where the write path stores it. */
describe("given a SpanReceivedEvent written through eventToRecord (real write path)", () => {
  describe("when getFromEventLog is called with matching ids and the oversize field name", () => {
    it("returns the field value, proving the read path matches the write path", async () => {
      const event = spanReceivedEvent([{ key: FIELD, value: { stringValue: FULL_VALUE } }]);
      const recording = new RecordingSeat().store({
        tenantId: TENANT_A,
        eventId: event.id,
        data: storedPayloadOf(event),
      });

      const value = await blobStoreOver(recording).getFromEventLog({
        eventId: event.id,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateId: AGGREGATE_ID,
      });

      expect(value).toBe(FULL_VALUE);
      expect(recording.reads).toHaveLength(1);
    });
  });
});

/** FALSIFIABILITY (#4888): non-string sibling attributes must not mask a >64KB offloaded field. */
describe("given a real OTLP payload whose span carries mixed-type siblings beside >64KB offloaded IO fields", () => {
  const BIG = "x".repeat(100 * 1024) + "🧪tail";
  const BIG_OUTPUT = "y".repeat(100 * 1024) + "🧪out";

  for (const [field, expected] of [
    ["langwatch.input", BIG],
    ["langwatch.output", BIG_OUTPUT],
  ] as const) {
    describe(`when getFromEventLog is called for ${field}`, () => {
      it("returns the FULL >64KB value despite non-string sibling attributes", async () => {
        const event = spanReceivedEvent([
          { key: "langwatch.input", value: { stringValue: BIG } },
          { key: "langwatch.output", value: { stringValue: BIG_OUTPUT } },
          ...MIXED_SIBLINGS,
        ]);
        const recording = new RecordingSeat().store({
          tenantId: TENANT_A,
          eventId: event.id,
          data: storedPayloadOf(event),
        });

        const value = await blobStoreOver(recording).getFromEventLog({
          eventId: event.id,
          field,
          tenantId: TENANT_A,
          aggregateId: AGGREGATE_ID,
        });

        expect(value).toBe(expected);
        expect(Buffer.byteLength(value, "utf8")).toBe(Buffer.byteLength(expected, "utf8"));
        expect(value.length).toBeGreaterThan(65536);
      });
    });
  }
});

function leanedSpanPointingAt({ eventId, preview }: { eventId: string; preview: string }) {
  const span: NormalizedSpan = {
    id: "abcd1234abcd1234",
    traceId: AGGREGATE_ID,
    spanId: "abcd1234abcd1234",
    tenantId: TENANT_A,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {
      "langwatch.input": preview,
      [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
        field: "langwatch.input",
        eventId,
      }),
    },
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
  return span;
}

describe("given a leaned span pointing at a real mixed-type trace event", () => {
  const BIG = "z".repeat(120 * 1024) + "🧪e2e";
  const preview = "z".repeat(IO_PREVIEW_BYTES) + "…";
  const resolve = ({ seat, eventId }: { seat: RecordingSeat; eventId: string }) => {
    const logger: WarnLogger = { warn: vi.fn(), error: vi.fn() };
    const result = TraceOffloadResolutionService.create().resolveOffloadedTraces({
      projectId: TENANT_A,
      normalizedSpans: [leanedSpanPointingAt({ eventId, preview })],
      blobStore: blobStoreOver(seat),
      ioExtractionService: TraceIOExtractionService.create(TraceCanonicalisationService.create()),
      logger,
    });
    return { result, logger };
  };

  describe("when resolveOffloadedTraces runs with a real TraceBlobStoreService over the seat", () => {
    it("restores the FULL langwatch.input and strips the reserved eventref key", async () => {
      const event = spanReceivedEvent([
        { key: "langwatch.input", value: { stringValue: BIG } },
        ...MIXED_SIBLINGS,
      ]);
      const seat = new RecordingSeat().store({
        tenantId: TENANT_A,
        eventId: event.id,
        data: storedPayloadOf(event),
      });

      const { result } = resolve({ seat, eventId: event.id });
      const resolved = await result;

      const attrs = resolved.resolvedSpans[0]!.spanAttributes as Record<string, string>;
      expect(attrs["langwatch.input"]).toBe(BIG);
      expect(Object.keys(attrs).some((k) => k.startsWith("langwatch.reserved."))).toBe(false);
      expect(resolved.anyResolved).toBe(true);
    });
  });

  describe("when the seat answers not found or the event lacks the field", () => {
    it.each([
      ["the event is not found", new RecordingSeat()],
      [
        "the field is absent",
        new RecordingSeat().store({ tenantId: TENANT_A, eventId: EVENT_ID, data: spanPayload([]) }),
      ],
    ])("keeps the preview and warns it as missing when %s", async (_case, seat) => {
      const { result, logger } = resolve({ seat, eventId: EVENT_ID });
      const resolved = await result;

      expect(resolved.resolvedSpans[0]!.spanAttributes["langwatch.input"]).toBe(preview);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attrKey: "langwatch.input" }),
        "event_log row not found for eventref — keeping preview value",
      );
    });
  });
});

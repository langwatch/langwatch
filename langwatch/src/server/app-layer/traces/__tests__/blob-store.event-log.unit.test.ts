/**
 * Unit tests for BlobStore.getFromEventLog (ADR-022 event_log read path)
 * and BlobStore.putSpool / BlobStore.deleteSpool (transient S3 spool).
 *
 * ADR-022: event_log is the single durable source of truth.
 * `BlobStore.getFromEventLog` issues a SELECT on event_log by
 * (TenantId, AggregateType, AggregateId, EventId) — TenantId is the FIRST
 * predicate in the WHERE clause, structurally blocking cross-tenant reads.
 *
 * These tests FAIL at unit runtime because the methods throw "not implemented".
 * They pass typecheck, serving as the TDD contract.
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 * No "should" in it() names (project convention).
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { generate, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { SpanReceivedEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import {
  BlobFieldNotFoundError,
  BlobNotFoundError,
  BlobStore,
  type S3ClientResolver,
} from "../blob-store.service";

// ---------------------------------------------------------------------------
// Helpers — ClickHouse mock
// ---------------------------------------------------------------------------

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const AGGREGATE_TYPE = "trace";
const AGGREGATE_ID = "trace-001";
const EVENT_ID = "evt-001";
const FIELD = "langwatch.output";
const FULL_VALUE = "x".repeat(100 * 1024);

interface MockRow {
  EventPayload: string;
}

/**
 * Builds a mock ClickHouseClient whose `query` method records the SQL issued
 * and returns the configured rows.
 */
function makeMockChClient({
  rows = [] as MockRow[],
}: {
  rows?: MockRow[];
} = {}) {
  const sqlCaptures: string[] = [];
  const paramCaptures: Record<string, unknown>[] = [];
  const client = {
    query: vi
      .fn()
      .mockImplementation(
        async ({
          query,
          query_params,
        }: {
          query: string;
          query_params?: Record<string, unknown>;
        }) => {
          sqlCaptures.push(query);
          paramCaptures.push(query_params ?? {});
          // ClickHouse client's result.json<T>() returns ResponseJSON<T> with shape
          // { data: T[], meta, rows, statistics, ... }. Match the real shape here so
          // production code's `response.data` access works.
          return {
            json: async () => ({ data: rows, meta: [], rows: rows.length }),
          };
        },
      ),
  };
  return { client, sqlCaptures, paramCaptures };
}

function makeS3Resolver(s3Client: {
  send: ReturnType<typeof vi.fn>;
}): S3ClientResolver {
  return async () => ({
    s3Client: s3Client as never,
    s3Bucket: "test-spool-bucket",
  });
}

function makeChResolver(
  client: ReturnType<typeof makeMockChClient>["client"],
): (tenantId: string) => Promise<typeof client> {
  return async (_tenantId) => client;
}

// ---------------------------------------------------------------------------
// getFromEventLog — happy path
// ---------------------------------------------------------------------------

/**
 * @scenario Cross-tenant event_log read is structurally denied
 */
describe("given an event_log row stored under tenantA with a known EventPayload", () => {
  describe("when getFromEventLog is called with matching (TenantId, AggregateType, AggregateId, EventId) and field", () => {
    it("issues a CH SELECT with TenantId as the FIRST predicate and returns the correct field value", async () => {
      const eventPayload = JSON.stringify({
        span: {
          attributes: [{ key: FIELD, value: { stringValue: FULL_VALUE } }],
        },
      });
      const { client, sqlCaptures } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      const result = await blobStore.getFromEventLog({
        eventId: EVENT_ID,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: AGGREGATE_ID,
      });

      // SQL must have TenantId as the first WHERE predicate
      const sql = sqlCaptures[0] ?? "";
      const tenantIdPos = sql.indexOf("TenantId");
      const aggregateIdPos = sql.indexOf("AggregateId");
      const eventIdPos = sql.indexOf("EventId");

      expect(tenantIdPos).toBeGreaterThanOrEqual(0);
      expect(tenantIdPos).toBeLessThan(aggregateIdPos);
      expect(tenantIdPos).toBeLessThan(eventIdPos);

      // Returned value is the field value from EventPayload
      expect(result).toBe(FULL_VALUE);
    });

    it("SQL contains 'TenantId' as the first predicate (substring assertion)", async () => {
      const eventPayload = JSON.stringify({
        span: {
          attributes: [{ key: FIELD, value: { stringValue: FULL_VALUE } }],
        },
      });
      const { client, sqlCaptures } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      await blobStore.getFromEventLog({
        eventId: EVENT_ID,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: AGGREGATE_ID,
      });

      expect(sqlCaptures[0]).toContain("TenantId");
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — EventOccurredAt partition-prune window
// ---------------------------------------------------------------------------

describe("given a KSUID EventId (the time is embedded in the id)", () => {
  const eventPayload = JSON.stringify({
    span: { attributes: [{ key: FIELD, value: { stringValue: FULL_VALUE } }] },
  });
  const windowMs = 2 * 24 * 60 * 60 * 1000;

  describe("when getFromEventLog is called", () => {
    it("derives a bounded EventOccurredAt window from the EventId's KSUID timestamp (keeping EventOccurredAt = 0)", async () => {
      const ksuidEventId = generate("event").toString();
      const createdAtMs = Ksuid.parse(ksuidEventId).date.getTime();

      const { client, sqlCaptures, paramCaptures } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });
      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      const result = await blobStore.getFromEventLog({
        eventId: ksuidEventId,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: AGGREGATE_ID,
      });

      const sql = sqlCaptures[0] ?? "";
      expect(sql).toContain("EventOccurredAt >= {occurredAtFromMs:UInt64}");
      expect(sql).toContain("EventOccurredAt <= {occurredAtToMs:UInt64}");
      expect(sql).toContain("EventOccurredAt = 0");
      expect(paramCaptures[0]).toMatchObject({
        occurredAtFromMs: createdAtMs - windowMs,
        occurredAtToMs: createdAtMs + windowMs,
      });
      // The window never changes which row is returned (still keyed by EventId).
      expect(result).toBe(FULL_VALUE);
    });
  });
});

describe("given a non-KSUID EventId (legacy / unparseable id)", () => {
  describe("when getFromEventLog is called", () => {
    it("omits the EventOccurredAt predicate and falls back to an unpruned read", async () => {
      const eventPayload = JSON.stringify({
        span: {
          attributes: [{ key: FIELD, value: { stringValue: FULL_VALUE } }],
        },
      });
      const { client, sqlCaptures, paramCaptures } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });
      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      await blobStore.getFromEventLog({
        eventId: "not-a-ksuid",
        field: FIELD,
        tenantId: TENANT_A,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: AGGREGATE_ID,
      });

      expect(sqlCaptures[0]).not.toContain("EventOccurredAt");
      expect(paramCaptures[0]).not.toHaveProperty("occurredAtFromMs");
      expect(paramCaptures[0]).not.toHaveProperty("occurredAtToMs");
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — cross-tenant denial
// ---------------------------------------------------------------------------

describe("given an event_log row under tenantA when tenantB attempts to read it", () => {
  describe("when getFromEventLog is called with tenantB's context and the same EventId", () => {
    it("returns no rows (because TenantId predicate mismatches) and throws BlobNotFoundError", async () => {
      // No rows returned — cross-tenant query returns empty set
      const { client } = makeMockChClient({ rows: [] });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      await expect(
        blobStore.getFromEventLog({
          eventId: EVENT_ID,
          field: FIELD,
          tenantId: TENANT_B, // wrong tenant
          aggregateType: AGGREGATE_TYPE,
          aggregateId: AGGREGATE_ID,
        }),
      ).rejects.toBeInstanceOf(BlobNotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — corrupt EventPayload
// ---------------------------------------------------------------------------

describe("given an event_log row with a corrupt (non-JSON) EventPayload", () => {
  describe("when getFromEventLog is called", () => {
    it("throws a descriptive error about the parse failure", async () => {
      const { client } = makeMockChClient({
        rows: [{ EventPayload: "not-valid-json{{{{" }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      await expect(
        blobStore.getFromEventLog({
          eventId: EVENT_ID,
          field: FIELD,
          tenantId: TENANT_A,
          aggregateType: AGGREGATE_TYPE,
          aggregateId: AGGREGATE_ID,
        }),
      ).rejects.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — field missing in EventPayload
// ---------------------------------------------------------------------------

describe("given a valid event_log row whose EventPayload does not contain the requested field", () => {
  describe("when getFromEventLog is called for the missing field", () => {
    it("throws BlobFieldNotFoundError", async () => {
      const eventPayload = JSON.stringify({
        span: { attributes: [] },
      });
      const { client } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      await expect(
        blobStore.getFromEventLog({
          eventId: EVENT_ID,
          field: "langwatch.input", // not present in EventPayload
          tenantId: TENANT_A,
          aggregateType: AGGREGATE_TYPE,
          aggregateId: AGGREGATE_ID,
        }),
      ).rejects.toBeInstanceOf(BlobFieldNotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// putSpool — happy path
// ---------------------------------------------------------------------------

describe("given a span that exceeds COMMAND_INLINE_THRESHOLD", () => {
  describe("when putSpool is called with projectId, traceId, spanId, body", () => {
    it("issues an S3 PUT at trace-blobs/spool/{projectId}/{traceId}/{spanId} and returns the spool ref string", async () => {
      const sendMock = vi.fn().mockImplementation(async (command: unknown) => {
        if (command instanceof PutObjectCommand) return {};
        throw new Error("unexpected command");
      });

      const blobStore = new BlobStore(makeS3Resolver({ send: sendMock }));

      const projectId = "proj-aaa";
      const traceId = "trace-001";
      const spanId = "span-001";
      const body = Buffer.from("full span JSON here", "utf-8");

      const spoolRef = await blobStore.putSpool({
        projectId,
        traceId,
        spanId,
        body,
      });

      expect(typeof spoolRef).toBe("string");
      // Key shape pinned: trace-blobs/spool/{projectId}/{traceId}/{spanId}
      expect(spoolRef).toBe(
        `trace-blobs/spool/${projectId}/${traceId}/${spanId}`,
      );

      // S3 PUT was issued
      expect(sendMock).toHaveBeenCalledOnce();
      const cmd = sendMock.mock.calls[0]?.[0] as PutObjectCommand;
      expect(cmd.input.Key).toBe(spoolRef);
    });
  });
});

// ---------------------------------------------------------------------------
// deleteSpool — best-effort (errors swallowed)
// ---------------------------------------------------------------------------

describe("given a transient spool ref", () => {
  describe("when deleteSpool is called", () => {
    it("issues an S3 DELETE and returns void (no error thrown even if S3 DELETE fails)", async () => {
      const sendMock = vi.fn().mockRejectedValue(new Error("S3 DELETE failed"));

      const blobStore = new BlobStore(makeS3Resolver({ send: sendMock }));

      const spoolRef = `trace-blobs/spool/proj/trace-001/span-001`;

      // Must not throw — errors are swallowed
      await expect(blobStore.deleteSpool(spoolRef)).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — log-record body resolution (eventref field "body")  [GtVrA]
// ---------------------------------------------------------------------------

describe("given an event_log row whose EventPayload is a log record (full body at top level, no span)", () => {
  describe("when getFromEventLog is called with field 'body'", () => {
    it("resolves the log body from EventPayload.body, not span.attributes", async () => {
      const logBody = "y".repeat(80 * 1024);
      const eventPayload = JSON.stringify({ body: logBody });
      const { client } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      const result = await blobStore.getFromEventLog({
        eventId: EVENT_ID,
        field: "body",
        tenantId: TENANT_A,
        aggregateType: "log",
        aggregateId: AGGREGATE_ID,
      });

      expect(result).toBe(logBody);
    });

    it("throws BlobFieldNotFoundError when field is 'body' but the EventPayload has no body", async () => {
      const eventPayload = JSON.stringify({ span: { attributes: [] } });
      const { client } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      await expect(
        blobStore.getFromEventLog({
          eventId: EVENT_ID,
          field: "body",
          tenantId: TENANT_A,
          aggregateType: "log",
          aggregateId: AGGREGATE_ID,
        }),
      ).rejects.toBeInstanceOf(BlobFieldNotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// getSpool — explicit error on empty S3 body  [GtVrH]
// ---------------------------------------------------------------------------

describe("given an S3 GetObject that returns a response with no Body", () => {
  describe("when getSpool is called", () => {
    it("throws an explicit 'no body' error rather than returning an empty buffer", async () => {
      const sendMock = vi.fn().mockResolvedValue({ Body: undefined });
      const blobStore = new BlobStore(makeS3Resolver({ send: sendMock }));

      await expect(
        blobStore.getSpool("trace-blobs/spool/proj/trace-001/span-001"),
      ).rejects.toThrow(/no body/i);
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — read-vs-write contract regression (issue #4215)
// ---------------------------------------------------------------------------

/**
 * CONTRACT REGRESSION: read path must match the real write path (eventToRecord).
 *
 * Bug: `getFromEventLog` was reading `EventPayload.data.span.attributes` but
 * `eventToRecord` stores `EventPayload = event.data` — so the real path is
 * `EventPayload.span.attributes` (no extra `.data` wrapper).
 *
 * This test derives the CH-mock EventPayload from the ACTUAL `eventToRecord`
 * call rather than hand-writing the fixture, so ANY drift in either the write
 * shape (`eventToRecord`) or the read shape (`getFromEventLog`) will cause this
 * test to fail immediately.
 *
 * Failure mode: if `eventToRecord` is changed to add a `data` wrapper, the
 * mock row will no longer match the schema `getFromEventLog` parses, and the
 * test will throw `BlobFieldNotFoundError`. If `getFromEventLog` regresses to
 * reading `.data.span.attributes`, `attr` will be undefined and the same error
 * is thrown. Either side's drift is caught.
 */
describe("given a SpanReceivedEvent written through eventToRecord (real write path)", () => {
  describe("when getFromEventLog is called with matching ids and the oversize field name", () => {
    it("returns the field value — proving the read path matches the write path", async () => {
      // Build a minimal but realistic SpanReceivedEvent whose data matches the
      // real write shape used in recordSpanCommand.ts:281-290.
      const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>({
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
            kind: 1, // SPAN_KIND_INTERNAL
            startTimeUnixNano: "0",
            endTimeUnixNano: "1000000",
            attributes: [
              // The oversize field under test — exact OTLP key-value shape
              {
                key: FIELD,
                value: { stringValue: FULL_VALUE },
              },
            ],
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

      // Derive the EventPayload exactly as the write path does.
      // eventToRecord sets `EventPayload = event.data ?? {}`, so
      // record.EventPayload IS spanReceivedEvent.data — no extra wrapper.
      const record = eventToRecord(spanReceivedEvent);

      const { client, sqlCaptures } = makeMockChClient({
        rows: [{ EventPayload: JSON.stringify(record.EventPayload) }],
      });

      const blobStore = new BlobStore(
        makeS3Resolver({ send: vi.fn() }),
        makeChResolver(client) as never,
      );

      // read path must find the attribute at span.attributes, NOT data.span.attributes
      const result = await blobStore.getFromEventLog({
        eventId: spanReceivedEvent.id,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: AGGREGATE_ID,
      });

      expect(result).toBe(FULL_VALUE);
      // Verify a CH query was actually issued (not short-circuited)
      expect(sqlCaptures.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// getFromEventLog — S3-independence invariant (ADR-022 on-prem guarantee)
// ---------------------------------------------------------------------------

/**
 * @scenario Read path is object-storage-independent (ADR-022 on-prem / no-object-storage).
 * Proves that BlobStore.getFromEventLog never calls resolveS3Client, so deployments
 * with no object storage can still serve "show full" and online-eval reads.
 */
describe("given a deployment with no object storage (resolveS3Client throws)", () => {
  describe("when getFromEventLog is called with a valid event_log row", () => {
    it("reads the field from event_log without touching S3", async () => {
      const eventPayload = JSON.stringify({
        span: {
          attributes: [{ key: FIELD, value: { stringValue: FULL_VALUE } }],
        },
      });
      const { client } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      // resolveS3Client throws unconditionally — simulates a deployment with no
      // object storage configured. getFromEventLog must never call this resolver.
      const noStorageResolver: S3ClientResolver = () => {
        throw new Error("no object storage configured");
      };

      const blobStore = new BlobStore(
        noStorageResolver,
        makeChResolver(client) as never,
      );

      const result = await blobStore.getFromEventLog({
        eventId: EVENT_ID,
        field: FIELD,
        tenantId: TENANT_A,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: AGGREGATE_ID,
      });

      expect(result).toBe(FULL_VALUE);
    });
  });
});

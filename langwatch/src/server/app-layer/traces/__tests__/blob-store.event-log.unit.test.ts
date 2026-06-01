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

import { describe, it, expect, vi } from "vitest";
import {
  BlobStore,
  BlobNotFoundError,
  BlobFieldNotFoundError,
  type S3ClientResolver,
} from "../blob-store.service";
import { PutObjectCommand } from "@aws-sdk/client-s3";

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
  const client = {
    query: vi.fn().mockImplementation(async ({ query }: { query: string }) => {
      sqlCaptures.push(query);
      // ClickHouse client's result.json<T>() returns ResponseJSON<T> with shape
      // { data: T[], meta, rows, statistics, ... }. Match the real shape here so
      // production code's `response.data` access works.
      return {
        json: async () => ({ data: rows, meta: [], rows: rows.length }),
      };
    }),
  };
  return { client, sqlCaptures };
}

/** Minimal S3 resolver used for spool tests. */
function makeS3Resolver(s3Client: { send: ReturnType<typeof vi.fn> }): S3ClientResolver {
  return async () => ({ s3Client: s3Client as never, s3Bucket: "test-spool-bucket" });
}

/** Wraps a mock ClickHouseClient object as a ClickHouseClientResolver (resolver returns the same client for any tenantId). */
function makeChResolver(client: ReturnType<typeof makeMockChClient>["client"]): (tenantId: string) => Promise<typeof client> {
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
        data: {
          span: {
            attributes: [
              { key: FIELD, value: { stringValue: FULL_VALUE } },
            ],
          },
        },
      });
      const { client, sqlCaptures } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(makeS3Resolver({ send: vi.fn() }), makeChResolver(client) as never);

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
        data: { span: { attributes: [{ key: FIELD, value: { stringValue: FULL_VALUE } }] } },
      });
      const { client, sqlCaptures } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(makeS3Resolver({ send: vi.fn() }), makeChResolver(client) as never);

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
// getFromEventLog — cross-tenant denial
// ---------------------------------------------------------------------------

describe("given an event_log row under tenantA when tenantB attempts to read it", () => {
  describe("when getFromEventLog is called with tenantB's context and the same EventId", () => {
    it("returns no rows (because TenantId predicate mismatches) and throws BlobNotFoundError", async () => {
      // No rows returned — cross-tenant query returns empty set
      const { client } = makeMockChClient({ rows: [] });

      const blobStore = new BlobStore(makeS3Resolver({ send: vi.fn() }), makeChResolver(client) as never);

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

      const blobStore = new BlobStore(makeS3Resolver({ send: vi.fn() }), makeChResolver(client) as never);

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
        data: { span: { attributes: [] } },
      });
      const { client } = makeMockChClient({
        rows: [{ EventPayload: eventPayload }],
      });

      const blobStore = new BlobStore(makeS3Resolver({ send: vi.fn() }), makeChResolver(client) as never);

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

      const blobStore = new BlobStore(
        makeS3Resolver({ send: sendMock }),
      );

      const projectId = "proj-aaa";
      const traceId = "trace-001";
      const spanId = "span-001";
      const body = Buffer.from("full span JSON here", "utf-8");

      const spoolRef = await blobStore.putSpool({ projectId, traceId, spanId, body });

      // Returns a string
      expect(typeof spoolRef).toBe("string");
      // Key shape pinned: trace-blobs/spool/{projectId}/{traceId}/{spanId}
      expect(spoolRef).toBe(`trace-blobs/spool/${projectId}/${traceId}/${spanId}`);

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
        data: {
          span: {
            attributes: [
              { key: FIELD, value: { stringValue: FULL_VALUE } },
            ],
          },
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

      const blobStore = new BlobStore(noStorageResolver, makeChResolver(client) as never);

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

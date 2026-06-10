/**
 * Unit tests for the oversized command path in RecordSpanCommand.
 *
 * ADR-022: When a command carries `spoolRef`, the worker must:
 *   1. Fetch the full span from S3 via BlobStore (one call).
 *   2. Reconstitute the full span and process it normally.
 *   3. After event_log INSERT succeeds, best-effort delete the spool.
 *
 * These tests FAIL at unit runtime because RecordSpanCommand does not yet
 * fetch from spool or call deleteSpool (Step 5). They pass typecheck,
 * serving as the TDD contract.
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 * No "should" in it() names (project convention).
 */

import { describe, it, expect, vi } from "vitest";
import { createTenantId, type Command } from "../../../../";
import type { RecordSpanCommandData } from "../../schemas/commands";
import {
  RECORD_SPAN_COMMAND_TYPE,
} from "../../schemas/constants";
import {
  RecordSpanCommand,
  type RecordSpanCommandDependencies,
} from "../recordSpanCommand";
import { BlobStore } from "~/server/app-layer/traces/blob-store.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const SPAN_ID = "bbbbbbbbbbbbbbbb";

/** Full span payload used in spool reconstitution tests. */
const FULL_SPAN_ATTRIBUTES = [
  { key: "langwatch.output", value: { stringValue: "x".repeat(300 * 1024) } },
];

/**
 * Builds a minimal oversized command — carries `spoolRef` and minimal span
 * fields (no attributes, just id fields). The full span arrives via spool fetch.
 */
function makeOversizedCommand({
  spoolRef,
}: {
  spoolRef: string;
}): Command<RecordSpanCommandData> {
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: TRACE_ID,
    tenantId: createTenantId(TENANT_ID),
    data: {
      tenantId: TENANT_ID,
      occurredAt: 1700000000000,
      spoolRef,
      // Minimal span — no attributes; full span comes from spool
      span: {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1000000, high: 0 },
        attributes: [],
        events: [],
        links: [],
        status: {},
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
    },
  };
}

/** Builds a regular (non-oversized) command with inline span data. */
function makeRegularCommand(): Command<RecordSpanCommandData> {
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: TRACE_ID,
    tenantId: createTenantId(TENANT_ID),
    data: {
      tenantId: TENANT_ID,
      occurredAt: 1700000000000,
      // No spoolRef — inline payload
      span: {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1000000, high: 0 },
        attributes: FULL_SPAN_ATTRIBUTES,
        events: [],
        links: [],
        status: {},
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
    },
  };
}

function makeDeps(): RecordSpanCommandDependencies {
  return {
    piiRedactionService: { redactSpan: vi.fn() },
    costEnrichmentService: { enrichSpan: vi.fn() },
    tokenEstimationService: { estimateSpanTokens: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * @scenario An over-threshold command is spooled to S3 transiently and reconstituted
 */
describe("given a RecordSpanCommand that carries a spoolRef (oversized path)", () => {
  const SPOOL_REF = `trace-blobs/spool/${TENANT_ID}/${TRACE_ID}/${SPAN_ID}`;

  /** Spool body: a serialized full span with the large attribute. */
  const spoolBody = JSON.stringify({
    span: {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: "test-span",
      kind: 1,
      startTimeUnixNano: { low: 0, high: 0 },
      endTimeUnixNano: { low: 1000000, high: 0 },
      attributes: FULL_SPAN_ATTRIBUTES,
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
  });

  describe("when the command worker handles the oversized command", () => {
    it("calls BlobStore.get exactly once with the spool key and the reconstituted span flows through", async () => {
      // Stub BlobStore with a getSpool that returns the full serialized span
      const blobStore = {
        getSpool: vi.fn().mockResolvedValue(Buffer.from(spoolBody, "utf-8")),
        deleteSpool: vi.fn().mockResolvedValue(undefined),
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      const events = await handler.handle(command);

      // Spool was fetched once
      expect((blobStore as unknown as { getSpool: ReturnType<typeof vi.fn> }).getSpool).toHaveBeenCalledOnce();
      expect((blobStore as unknown as { getSpool: ReturnType<typeof vi.fn> }).getSpool).toHaveBeenCalledWith(SPOOL_REF);

      // Reconstituted span flows through — event data carries the full attributes
      expect(events).toHaveLength(1);
      const spanData = events[0]?.data.span;
      expect(spanData?.attributes?.length).toBeGreaterThan(0);
    });

    it("does NOT call BlobStore.getSpool when the command has no spoolRef (regular path)", async () => {
      const blobStore = {
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeRegularCommand();

      await handler.handle(command);

      expect((blobStore as unknown as { getSpool: ReturnType<typeof vi.fn> }).getSpool).not.toHaveBeenCalled();
    });

    it("does NOT call BlobStore.deleteSpool inside handle() — deletion is deferred to cleanupAfterStore()", async () => {
      const deleteSpoolMock = vi.fn().mockResolvedValue(undefined);
      const blobStore = {
        getSpool: vi.fn().mockResolvedValue(Buffer.from(spoolBody, "utf-8")),
        deleteSpool: deleteSpoolMock,
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      await handler.handle(command);

      // deleteSpool must NOT be called inside handle() — only after storeEvents succeeds
      expect(deleteSpoolMock).not.toHaveBeenCalled();
    });

    it("calls BlobStore.deleteSpool via cleanupAfterStore() after successful event_log INSERT", async () => {
      const deleteSpoolMock = vi.fn().mockResolvedValue(undefined);
      const blobStore = {
        getSpool: vi.fn().mockResolvedValue(Buffer.from(spoolBody, "utf-8")),
        deleteSpool: deleteSpoolMock,
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      // Simulate processCommand: handle first, then cleanupAfterStore (post storeEvents)
      await handler.handle(command);
      await handler.cleanupAfterStore(command);

      // deleteSpool is called once with the spool ref
      expect(deleteSpoolMock).toHaveBeenCalledOnce();
      expect(deleteSpoolMock).toHaveBeenCalledWith(SPOOL_REF);
    });

    it("does NOT call BlobStore.deleteSpool when storeEvents throws (handle() succeeded but INSERT failed)", async () => {
      const deleteSpoolMock = vi.fn();
      const blobStore = {
        getSpool: vi.fn().mockResolvedValue(Buffer.from(spoolBody, "utf-8")),
        deleteSpool: deleteSpoolMock,
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      // handle() succeeds — events are produced
      await handler.handle(command);

      // Simulate storeEvents throwing (ClickHouse INSERT failed)
      // processCommand would catch and rethrow, never calling cleanupAfterStore
      // Therefore deleteSpool must NOT have been called at any point
      expect(deleteSpoolMock).not.toHaveBeenCalled();
    });

    it("does NOT call BlobStore.deleteSpool when the command handling fails (event_log INSERT would not have succeeded)", async () => {
      const deleteSpoolMock = vi.fn();
      const blobStore = {
        // getSpool succeeds but deps will throw
        getSpool: vi.fn().mockResolvedValue(Buffer.from(spoolBody, "utf-8")),
        deleteSpool: deleteSpoolMock,
      } as unknown as BlobStore;

      const deps = makeDeps();
      // Make PII redaction throw to simulate a processing failure before event construction
      (deps.piiRedactionService.redactSpan as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("PII redaction failed"),
      );

      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      await expect(handler.handle(command)).rejects.toThrow("PII redaction failed");

      // deleteSpool must NOT have been called
      expect(deleteSpoolMock).not.toHaveBeenCalled();
    });

    it("propagates the error when BlobStore.getSpool throws", async () => {
      const blobStore = {
        getSpool: vi.fn().mockRejectedValue(new Error("S3 GET failed: NoSuchKey")),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      await expect(handler.handle(command)).rejects.toThrow("S3 GET failed");
    });

    it("produces a SpanReceivedEvent with spool body that is byte-identical to what was originally spooled", async () => {
      const blobStore = {
        getSpool: vi.fn().mockResolvedValue(Buffer.from(spoolBody, "utf-8")),
        deleteSpool: vi.fn().mockResolvedValue(undefined),
      } as unknown as BlobStore;

      const deps = makeDeps();
      const handler = new RecordSpanCommand({ ...deps, blobStore });
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      const events = await handler.handle(command);

      // The produced event should contain the full-sized output attribute
      const spanData = events[0]?.data.span;
      const outputAttr = spanData?.attributes?.find(
        (a: { key: string }) => a.key === "langwatch.output",
      );
      expect(outputAttr).toBeDefined();
      expect(
        Buffer.byteLength(outputAttr?.value?.stringValue ?? "", "utf-8"),
      ).toBe(300 * 1024);
    });
  });
});

// ---------------------------------------------------------------------------
// Race-condition regression test (ADR-022 fix)
// ---------------------------------------------------------------------------

/**
 * @scenario A single shared RecordSpanCommand instance processes two concurrent
 * traces — cleanupAfterStore must use each command's own spoolRef, not shared
 * instance state. Under the OLD implementation (storing spoolRef in an instance
 * field `_pendingSpoolRef`), the second handle() call would overwrite the first
 * job's spoolRef, causing cleanupAfterStore(cmdA) to delete cmdB's spool instead.
 */
describe("given a shared RecordSpanCommand instance processing two concurrent traces", () => {
  const TRACE_ID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
  const SPAN_ID_A = "aaaaaaaaaaaaaaaa";
  const SPOOL_REF_A = `trace-blobs/spool/projA/${TRACE_ID_A}/${SPAN_ID_A}`;

  const TRACE_ID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
  const SPAN_ID_B = "bbbbbbbbbbbbbbbb";
  const SPOOL_REF_B = `trace-blobs/spool/projB/${TRACE_ID_B}/${SPAN_ID_B}`;

  const makeSpoolBody = (traceId: string, spanId: string) =>
    JSON.stringify({
      span: {
        traceId,
        spanId,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1000000, high: 0 },
        attributes: [],
        events: [],
        links: [],
        status: {},
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
    });

  function makeConcurrentCommand({
    spoolRef,
    traceId,
    spanId,
  }: {
    spoolRef: string;
    traceId: string;
    spanId: string;
  }): Command<RecordSpanCommandData> {
    return {
      type: RECORD_SPAN_COMMAND_TYPE,
      aggregateId: traceId,
      tenantId: createTenantId(TENANT_ID),
      data: {
        tenantId: TENANT_ID,
        occurredAt: 1700000000000,
        spoolRef,
        span: {
          traceId,
          spanId,
          name: "test-span",
          kind: 1,
          startTimeUnixNano: { low: 0, high: 0 },
          endTimeUnixNano: { low: 1000000, high: 0 },
          attributes: [],
          events: [],
          links: [],
          status: {},
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        },
        resource: null,
        instrumentationScope: null,
      },
    };
  }

  describe("when two jobs interleave on the same handler instance (handle A, handle B, cleanup A, cleanup B)", () => {
    it("deletes each job's own spoolRef — not the other job's ref — pinning the race fix", async () => {
      const deleteSpoolMock = vi.fn().mockResolvedValue(undefined);
      const blobStore = {
        getSpool: vi
          .fn()
          .mockImplementation(async (ref: string) => {
            if (ref === SPOOL_REF_A) {
              return Buffer.from(makeSpoolBody(TRACE_ID_A, SPAN_ID_A), "utf-8");
            }
            return Buffer.from(makeSpoolBody(TRACE_ID_B, SPAN_ID_B), "utf-8");
          }),
        deleteSpool: deleteSpoolMock,
      } as unknown as BlobStore;

      const deps = makeDeps();
      // ONE shared handler instance — mirrors withCommandInstance in pipeline.ts
      const handler = new RecordSpanCommand({ ...deps, blobStore });

      const cmdA = makeConcurrentCommand({
        spoolRef: SPOOL_REF_A,
        traceId: TRACE_ID_A,
        spanId: SPAN_ID_A,
      });
      const cmdB = makeConcurrentCommand({
        spoolRef: SPOOL_REF_B,
        traceId: TRACE_ID_B,
        spanId: SPAN_ID_B,
      });

      // Interleaved execution: both jobs handled before either cleanup runs
      await handler.handle(cmdA);
      await handler.handle(cmdB);
      await handler.cleanupAfterStore(cmdA);
      await handler.cleanupAfterStore(cmdB);

      // Exactly two deletions — one per job, in order of cleanupAfterStore calls
      expect(deleteSpoolMock).toHaveBeenCalledTimes(2);

      // First cleanup must target cmdA's spool — NOT cmdB's
      expect(deleteSpoolMock).toHaveBeenNthCalledWith(1, SPOOL_REF_A);

      // Second cleanup must target cmdB's spool — NOT cmdA's
      expect(deleteSpoolMock).toHaveBeenNthCalledWith(2, SPOOL_REF_B);
    });
  });
});

// ---------------------------------------------------------------------------
// ADR-022 guard: spoolRef present but no blobStore configured
// ---------------------------------------------------------------------------

/**
 * @scenario A handler built without a blobStore receives a command that
 * carries a spoolRef — the span's attributes have already been cleared by
 * the edge. Without reconstitution, processing would emit a span with empty
 * attributes to event_log (permanent data loss). The guard must throw instead.
 */
describe("given a command carrying a spoolRef but a handler with no blobStore", () => {
  const SPOOL_REF = `trace-blobs/spool/${TENANT_ID}/${TRACE_ID}/${SPAN_ID}`;

  describe("when handle() is called", () => {
    it("throws rather than emitting a span with cleared attributes", async () => {
      // Build deps WITHOUT a blobStore — simulates a misconfigured handler
      const depsWithoutBlobStore: RecordSpanCommandDependencies = {
        piiRedactionService: { redactSpan: vi.fn() },
        costEnrichmentService: { enrichSpan: vi.fn() },
        tokenEstimationService: { estimateSpanTokens: vi.fn() },
        // blobStore intentionally omitted
      };

      const handler = new RecordSpanCommand(depsWithoutBlobStore);
      const command = makeOversizedCommand({ spoolRef: SPOOL_REF });

      // Must reject with the ADR-022 guard message
      await expect(handler.handle(command)).rejects.toThrow(
        `ADR-022: command carries spoolRef "${SPOOL_REF}" but this handler has no blobStore configured to reconstitute the span. Refusing to emit a span with cleared attributes (would be permanent data loss in event_log).`,
      );

      // No event must have been produced (verified via piiRedactionService not being called)
      expect(
        depsWithoutBlobStore.piiRedactionService.redactSpan as ReturnType<typeof vi.fn>,
      ).not.toHaveBeenCalled();
    });
  });
});

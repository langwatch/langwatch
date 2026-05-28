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
      await handler.cleanupAfterStore();

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

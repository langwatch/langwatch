/**
 * Fixtures for the restoreStoredSpanAttributes tests (#5753): an offloaded
 * stored span, a blob store stub that records its event_log reads, and a
 * service built around them.
 */

import { vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import {
  NullSpanStorageRepository,
  type StoredTraceSpan,
} from "~/server/app-layer/traces/repositories/span-storage.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";

export const PROJECT = "proj-1";
export const AGGREGATE = "agg-1";
export const MEMBER = "member-1";
export const TRACE_ID = "trace-1";
export const STARTED_AT = 1_700_000_000_000;
export const FULL_INPUT = "The full 70 KB prompt that was offloaded to event_log";
export const PREVIEW_INPUT = "The full 70 KB prompt that was offloaded…";
export const REF_KEY = `${EVENTREF_ATTR_PREFIX}langwatch.input`;

export function offloadedSpan(): StoredTraceSpan {
  return {
    spanId: "span-llm",
    traceId: TRACE_ID,
    parentSpanId: null,
    name: "llm-call",
    spanAttributes: {
      "langwatch.span.type": "llm",
      "langwatch.input": PREVIEW_INPUT,
      [REF_KEY]: JSON.stringify({ field: "langwatch.input", eventId: "evt-1" }),
    },
    startTimeUnixMs: STARTED_AT,
    endTimeUnixMs: STARTED_AT + 100,
    durationMs: 100,
    statusCode: 1,
    statusMessage: null,
  };
}

export function plainSpan(): StoredTraceSpan {
  const span = offloadedSpan();
  delete span.spanAttributes[REF_KEY];
  return span;
}

export function blobStoreReturning(
  read: () => Promise<string>,
): BlobStore & { getFromEventLog: ReturnType<typeof vi.fn> } {
  return {
    getFromEventLog: vi.fn(read),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore & { getFromEventLog: ReturnType<typeof vi.fn> };
}

export const holdsFullInput = () => blobStoreReturning(async () => FULL_INPUT);

export function serviceWith(blobStore?: BlobStore) {
  return new SpanStorageService(
    new NullSpanStorageRepository(),
    blobStore
      ? { blobStore, ioExtractionService: new TraceIOExtractionService() }
      : undefined,
  );
}

export const eventRefKeys = (attributes: Record<string, unknown>) =>
  Object.keys(attributes).filter((k) => k.startsWith(EVENTREF_ATTR_PREFIX));


/**
 * Fixtures for the restoreStoredSpanAttributes tests (#5753): an offloaded
 * stored span, a blob store stub that records its event_log reads, and a
 * service built around them.
 */

import { type Authorization, sealAuthorization } from "@langwatch/actor";
import { AUTHORIZATION_MAX_AGE_MS } from "~/server/app-layer/authz/authorization.service";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import {
  NullSpanStorageRepository,
  type StoredTraceSpan,
} from "~/server/app-layer/traces/repositories/span-storage.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { makeBlobStore } from "~/server/traces/__tests__/fixtures/prompt-studio-offload-fixtures";

export const PROJECT = "proj-1";
export const AGGREGATE = "agg-1";
export const MEMBER = "member-1";
export const TRACE_ID = "trace-1";
export const STARTED_AT = 1_700_000_000_000;
export const FULL_INPUT =
  "The full 70 KB prompt that was offloaded to event_log";
export const PREVIEW_INPUT = "The full 70 KB prompt that was offloaded…";
export const REF_KEY = `${EVENTREF_ATTR_PREFIX}langwatch.input`;

export const FULL_OUTPUT =
  "The full 70 KB answer that was offloaded to event_log";
export const PREVIEW_OUTPUT = "The full 70 KB answer that was offloaded…";
export const OUTPUT_REF_KEY = `${EVENTREF_ATTR_PREFIX}langwatch.output`;

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

/** An offloaded span whose output was offloaded too, under its own event. */
export function offloadedSpanWithOutput(): StoredTraceSpan {
  const span = offloadedSpan();
  span.spanAttributes["langwatch.output"] = PREVIEW_OUTPUT;
  span.spanAttributes[OUTPUT_REF_KEY] = JSON.stringify({
    field: "langwatch.output",
    eventId: "evt-2",
  });
  return span;
}

/**
 * A sealed proof whose own grant carries no traces read: the fence refuses it
 * with AccessNotGrantedError before anything is read.
 */
export function ungrantedProof(): Authorization {
  const actor = { type: "user", id: "test-user" } as const;
  return sealAuthorization({
    actor,
    principal: actor,
    scope: { organizationId: "test-organization" },
    grants: [
      {
        projectId: PROJECT,
        permissions: ["analytics:view"],
        via: [],
        kind: "own",
      },
    ],
    expiresAt: Date.now() + AUTHORIZATION_MAX_AGE_MS,
    purpose: { kind: "route", route: "test" },
  });
}

export function plainSpan(): StoredTraceSpan {
  const span = offloadedSpan();
  delete span.spanAttributes[REF_KEY];
  return span;
}

/** A blob store holding the full input only; any other field is missing. */
export const holdsFullInput = () =>
  makeBlobStore({ "langwatch.input": FULL_INPUT }).blobStore;

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

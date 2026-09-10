/**
 * Shared fixtures for the ADR-022 prompt-studio read tests (#5753).
 *
 * Two suites need the same offloaded span: the ClickHouse read that turns it
 * into playground messages, and the resolver primitive underneath. They live in
 * separate files so neither grows past the source-line ceiling, so the fixtures
 * live here rather than being copied into both.
 *
 * Deliberately small: only the columns `getSpanForPromptStudio`'s SELECT
 * returns, and only the `NormalizedSpan` fields the resolver reads.
 */

import { vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { Protections } from "~/server/traces/protections";

export const PROJECT_ID = "proj-1";
export const TRACE_ID = "trace-1";
export const LLM_SPAN_ID = "span-llm";
export const SIBLING_SPAN_ID = "span-sibling";

export const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
} as Protections;

/** What the playground should end up showing: the whole prompt. */
export const fullInput = JSON.stringify([
  { role: "system", content: "You are a careful assistant." },
  { role: "user", content: `Summarise this: ${"x".repeat(70_000)}` },
]);

/** What stored_spans holds instead: the bounded preview. */
export const previewInput = JSON.stringify([
  { role: "system", content: "You are a careful assistant." },
  { role: "user", content: "Summarise this: xxx…" },
]);

/** The user turn as it reads once resolution has restored it. */
export const fullUserTurn = `Summarise this: ${"x".repeat(70_000)}`;

/** The user turn as it reads while only the preview is available. */
export const previewUserTurn = "Summarise this: xxx…";

/** One row in the shape getSpanForPromptStudio's SELECT returns. */
export function makeRow({
  spanId,
  attributes,
}: {
  spanId: string;
  attributes: Record<string, unknown>;
}) {
  return {
    SpanId: spanId,
    TraceId: TRACE_ID,
    ParentSpanId: null,
    SpanName: "llm-call",
    SpanAttributes: attributes,
    StartTime: 1_700_000_000_000,
    EndTime: 1_700_000_000_100,
    DurationMs: 100,
    StatusCode: 1,
    StatusMessage: "",
  };
}

export function llmRowWithEventRef() {
  return makeRow({
    spanId: LLM_SPAN_ID,
    attributes: {
      "langwatch.span.type": "llm",
      "langwatch.input": previewInput,
      [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
        field: "langwatch.input",
        eventId: "evt-1",
      }),
    },
  });
}

export function llmRowWithoutEventRef() {
  return makeRow({
    spanId: LLM_SPAN_ID,
    attributes: {
      "langwatch.span.type": "llm",
      "langwatch.input": previewInput,
    },
  });
}

/** A non-llm sibling in the same trace, carrying its own offloaded field. */
export function siblingRowWithEventRef() {
  return makeRow({
    spanId: SIBLING_SPAN_ID,
    attributes: {
      "langwatch.span.type": "span",
      "langwatch.output": "sibling preview…",
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
        eventId: "evt-sibling",
      }),
    },
  });
}

/** A NormalizedSpan carrying just what the resolver reads. */
export function normalized({
  spanId,
  spanAttributes,
}: {
  spanId: string;
  spanAttributes: Record<string, unknown>;
}): NormalizedSpan {
  return { spanId, traceId: TRACE_ID, spanAttributes } as NormalizedSpan;
}

export type EventLogRead = {
  eventId: string;
  field: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
};

/**
 * BlobStore stub that records every event_log read, so "resolved from the right
 * tenant" and "did not read at all" are both observable.
 */
export function makeBlobStore(contents: Record<string, string>) {
  const reads: EventLogRead[] = [];
  const blobStore = {
    getFromEventLog: vi.fn(async (params: EventLogRead) => {
      reads.push(params);
      const value = contents[params.field];
      if (value === undefined) {
        throw new BlobNotFoundError(params.eventId, params.field, PROJECT_ID);
      }
      return value;
    }),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
  return { blobStore, reads };
}

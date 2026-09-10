/**
 * Walks scenario message payloads, externalizing inline media: decodes base64, content-addresses
 * the bytes, and rewrites the part to reference the stored object by URL. It speaks the tracer's
 * rich-content shape, mints URLs carrying the owning projectId, and passes the rest through.
 */

import { TraceContentArrayService } from "./trace-content-array.service.ts";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { visitContentPartAsync } from "@langwatch/trace-contract";

import type { TraceMediaStore } from "../../app/trace.infrastructure.ts";
import {
  extractBareImagePart,
  extractBinaryPart,
  extractImageUrlPart,
  extractInputAudioPart,
  extractMediaPart,
  type ExtractedPart,
  type ExtractedRef,
  type ExtractionContext,
} from "../../rules/content-part-extraction.rules.ts";

const tracer = getLangWatchTracer("langwatch.stored-objects.content-extractor");

const logger = createLogger("langwatch:stored-objects:content-extractor");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-message walker
// ---------------------------------------------------------------------------

interface ExtractionParams {
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: TraceMediaStore;
}

/**
 * Walks one message's content array, externalizing inline media. The same message reference comes
 * back when nothing was rewritten, so the dispatcher can spot a no-op without diffing bytes; a
 * store failure propagates. Each part dispatches by shape, and unknown shapes pass through.
 */
async function rewriteMessage(
  rawMessage: Record<string, unknown>,
  params: ExtractionParams,
): Promise<{ message: Record<string, unknown>; refs: ExtractedRef[] }> {
  const contentArray = TraceContentArrayService.tryCoerceContentToArray(rawMessage.content);
  if (contentArray === null) {
    return { message: rawMessage, refs: [] };
  }

  const refs: ExtractedRef[] = [];
  const rewrittenParts: unknown[] = [];
  let changed = false;
  for (const raw of contentArray) {
    const { part: rewritten, ref } = await TraceContentExtractionService.processContentPart({
      part: raw,
      ...params,
    });
    if (rewritten !== raw) {
      changed = true;
    }

    rewrittenParts.push(rewritten);
    if (ref !== null) {
      refs.push(ref);
    }
  }

  if (!changed) {
    return { message: rawMessage, refs };
  }

  return { message: { ...rawMessage, content: rewrittenParts }, refs };
}

/**
 * Walks every message in an event's messages array. The original messages reference and empty refs
 * come back when no message changed, preserving identity at the event level so the dispatcher can
 * short-circuit cleanly.
 */
async function rewriteMessageArray(
  messages: unknown[],
  params: ExtractionParams,
): Promise<{ messages: unknown[]; refs: ExtractedRef[]; changed: boolean }> {
  const out: unknown[] = [];
  const allRefs: ExtractedRef[] = [];
  let changed = false;
  for (const m of messages) {
    if (m && typeof m === "object" && !Array.isArray(m)) {
      const { message: rewritten, refs } = await rewriteMessage(
        m as Record<string, unknown>,
        params,
      );
      if (rewritten !== m) {
        changed = true;
      }

      out.push(rewritten);
      allRefs.push(...refs);
    } else {
      out.push(m);
    }
  }

  return { messages: out, refs: allRefs, changed };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class TraceContentExtractionService {
  static create(): TraceContentExtractionService {
    return new TraceContentExtractionService();
  }

  /**
   * Rewrites one content part, storing inline bytes via the service, and returns the possibly new
   * part with an optional ref. The part is unknown because the walker no longer pre-validates
   * against one schema. Exported for the generic value walker, which reads arbitrary JSON.
   */
  static async processContentPart({
    part,
    projectId,
    purpose,
    ownerKind,
    ownerId,
    service,
  }: {
    part: unknown;
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    service: TraceMediaStore;
  }): Promise<{ part: unknown; ref: ExtractedRef | null }> {
    const context: ExtractionContext = {
      part,
      projectId,
      purpose,
      ownerKind,
      ownerId,
      service,
      logger,
    };
    const noOp: ExtractedPart = { part, ref: null };

    const result = await visitContentPartAsync<ExtractedPart>(part, {
      text: () => noOp,
      toolCall: () => noOp,
      toolResult: () => noOp,
      media: (mediaPart) => extractMediaPart(context, mediaPart),
      binary: (binPart) => extractBinaryPart(context, binPart),
      imageUrl: (url) => extractImageUrlPart(context, url),
      inputAudio: (audioPart) => extractInputAudioPart(context, audioPart),
      bareImage: (src) => extractBareImagePart(context, src),
    });

    return result ?? noOp;
  }

  /**
   * Walks an event payload, externalizes inline media found in message content arrays and returns
   * a new event whose parts reference the stored objects. Both event shapes are handled; an
   * unrecognized one comes back unchanged, and a store failure rethrows.
   */
  static async extractInlineMediaFromEvent({
    event,
    projectId,
    ownerKind,
    ownerId,
    purpose,
    service,
  }: {
    event: unknown;
    projectId: string;
    ownerKind: string;
    ownerId: string;
    purpose: string;
    service: TraceMediaStore;
  }): Promise<{ rewrittenEvent: unknown; refs: ExtractedRef[] }> {
    return tracer.withActiveSpan(
      "StoredObjects.extractInlineMediaFromEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "stored_objects.purpose": purpose,
          "stored_objects.owner_kind": ownerKind,
          // owner_id is customer-controlled. Acceptable here because tenant_id is also on the span
          // and owner_id is low-entropy by design; operators running shared OTEL backends should
          // know this attribute is searchable across tenants unless their backend scopes queries.
          "stored_objects.owner_id": ownerId,
        },
      },
      async (span) => {
        if (typeof event !== "object" || event === null) {
          span.setAttribute("stored_objects.refs_extracted", 0);

          return { rewrittenEvent: event, refs: [] };
        }

        const params: ExtractionParams = {
          projectId,
          purpose,
          ownerKind,
          ownerId,
          service,
        };
        const eventObj = event as Record<string, unknown>;

        // Shape A: `event.message` is a single message object.
        if (
          eventObj.message &&
          typeof eventObj.message === "object" &&
          !Array.isArray(eventObj.message)
        ) {
          const original = eventObj.message as Record<string, unknown>;
          const { message, refs } = await rewriteMessage(original, params);
          span.setAttribute("stored_objects.refs_extracted", refs.length);
          if (message === original) {
            return { rewrittenEvent: event, refs };
          }

          return { rewrittenEvent: { ...eventObj, message }, refs };
        }

        // Shape B: `event.messages` is an array of message objects.
        if (Array.isArray(eventObj.messages)) {
          const { messages, refs, changed } = await rewriteMessageArray(eventObj.messages, params);
          span.setAttribute("stored_objects.refs_extracted", refs.length);
          if (!changed) {
            return { rewrittenEvent: event, refs };
          }

          return { rewrittenEvent: { ...eventObj, messages }, refs };
        }

        span.setAttribute("stored_objects.refs_extracted", 0);

        return { rewrittenEvent: event, refs: [] };
      },
    );
  }
}

/**
 * content-extractor.ts — walks AG-UI event payloads, externalizes inline media.
 *
 * For every message content part that carries inline byte data (image/audio/video/document
 * with source.type="data", or binary parts with the data field set), this module:
 *  1. Decodes the base64 payload.
 *  2. Calls `service.storeFromBytes` to content-address the bytes.
 *  3. Rewrites the part to reference the stored object by URL.
 *
 * The walker is deliberately narrow: it only touches the fields it understands and
 * leaves everything else untouched. If the content array fails AG-UI schema validation
 * the entire event is returned unchanged ("degraded, not broken").
 */
import { InputContentSchema } from "@ag-ui/core";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { z } from "zod";
import { createLogger } from "~/utils/logger/server";
import { binaryInputPartSchema } from "./binary-part";
import { isReadbackSafe } from "./safe-media-types";
import type { StoredObjectsService } from "./stored-objects.service";

const tracer = getLangWatchTracer("langwatch.stored-objects.content-extractor");

const logger = createLogger("langwatch:stored-objects:content-extractor");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A record of one stored object created (or deduplicated) during extraction.
 */
export interface ExtractedRef {
  id: string;
  isDuplicate: boolean;
  purpose: string;
  ownerKind: string;
  ownerId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** AG-UI content part union type inferred from the schema. */
type InputContentPart = z.infer<typeof InputContentSchema>;

/**
 * Rewrites a single content part, storing any inline bytes via the service.
 * Returns the (possibly new) part and an optional ref.
 */
async function processContentPart({
  part,
  projectId,
  purpose,
  ownerKind,
  ownerId,
  service,
}: {
  part: InputContentPart;
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: StoredObjectsService;
}): Promise<{ part: InputContentPart; ref: ExtractedRef | null }> {
  // image / audio / video / document parts with source.type="data"
  if (
    (part.type === "image" ||
      part.type === "audio" ||
      part.type === "video" ||
      part.type === "document") &&
    part.source.type === "data"
  ) {
    const { value: base64, mimeType } = part.source;

    // For document parts, reject MIME types the read path can't faithfully
    // serve. The /api/files route downgrades anything outside the allowlist to
    // application/octet-stream, so text/csv, application/json, etc. would
    // ingest silently but come back as a blob download. Pass through unchanged
    // rather than corrupt the round-trip.
    if (part.type === "document" && !isReadbackSafe(mimeType)) {
      logger.debug(
        { mimeType },
        "document part has an unsafe MIME type — passing through unchanged",
      );
      return { part, ref: null };
    }

    const bytes = Buffer.from(base64, "base64");

    const result = await service.storeFromBytes({
      projectId,
      purpose,
      ownerKind,
      ownerId,
      mediaType: mimeType,
      bytes,
    });

    const ref: ExtractedRef = {
      id: result.id,
      isDuplicate: result.isDuplicate,
      purpose,
      ownerKind,
      ownerId,
    };

    const rewrittenPart: InputContentPart = {
      ...part,
      source: { type: "url", value: `/api/files/${result.id}`, mimeType },
    };

    return { part: rewrittenPart, ref };
  }

  // binary parts: enforce exactly-one-of(data, url, id) at the boundary
  // before we touch them. AG-UI's InputContentSchema permits the
  // ambiguous "all three set" / "none set" cases; rejecting them here
  // matches the runtime invariant the extractor depends on. A failed
  // safeParse falls back to "no inline data to extract" — the caller's
  // degraded-passthrough path takes care of the rest.
  if (part.type === "binary") {
    const refined = binaryInputPartSchema.safeParse(part);
    if (!refined.success) {
      logger.debug(
        { error: refined.error.message },
        "binary part violates exactly-one-of(data,url,id); passing through unchanged",
      );
      return { part, ref: null };
    }
  }

  // binary parts where data is set and id/url are not already present
  if (
    part.type === "binary" &&
    part.data !== undefined &&
    part.id === undefined &&
    part.url === undefined
  ) {
    const { data, mimeType } = part;
    const bytes = Buffer.from(data, "base64");

    const result = await service.storeFromBytes({
      projectId,
      purpose,
      ownerKind,
      ownerId,
      mediaType: mimeType,
      bytes,
    });

    const ref: ExtractedRef = {
      id: result.id,
      isDuplicate: result.isDuplicate,
      purpose,
      ownerKind,
      ownerId,
    };

    const rewrittenPart: InputContentPart = {
      ...part,
      id: result.id,
      url: `/api/files/${result.id}`,
      data: undefined,
    };

    return { part: rewrittenPart, ref };
  }

  // No inline data to extract — return unchanged
  return { part, ref: null };
}

// ---------------------------------------------------------------------------
// Per-message walker
// ---------------------------------------------------------------------------

interface ExtractionParams {
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: StoredObjectsService;
}

/**
 * Walks a single message's `content` array, externalizing inline media.
 *
 * - Returns the same message reference when nothing was rewritten (no
 *   content array, or a part failed AG-UI parse and the whole message
 *   is passed through unchanged). Reference identity lets the event
 *   dispatcher above detect "no-op" without diffing the bytes.
 * - On `storeFromBytes` failure, the error propagates out — the caller
 *   maps it to a 5xx and rolls back the event.
 */
async function rewriteMessage(
  rawMessage: Record<string, unknown>,
  params: ExtractionParams,
): Promise<{ message: Record<string, unknown>; refs: ExtractedRef[] }> {
  if (!Array.isArray(rawMessage.content)) {
    return { message: rawMessage, refs: [] };
  }

  const parsedParts: InputContentPart[] = [];
  for (const raw of rawMessage.content as unknown[]) {
    const result = InputContentSchema.safeParse(raw);
    if (!result.success) {
      logger.debug(
        { error: result.error.message },
        "content part failed AG-UI parse — passing message through unchanged",
      );
      return { message: rawMessage, refs: [] };
    }
    parsedParts.push(result.data);
  }

  const refs: ExtractedRef[] = [];
  const rewrittenParts: InputContentPart[] = [];
  let changed = false;
  for (const part of parsedParts) {
    const { part: rewritten, ref } = await processContentPart({
      part,
      ...params,
    });
    if (rewritten !== part) changed = true;
    rewrittenParts.push(rewritten);
    if (ref !== null) refs.push(ref);
  }
  if (!changed) return { message: rawMessage, refs };
  return { message: { ...rawMessage, content: rewrittenParts }, refs };
}

/**
 * Walks every message in an event's `messages` array.
 *
 * Returns the original `messages` reference (and an empty refs list) when
 * no message changed. Preserves reference identity at the event level so
 * the dispatcher can short-circuit cleanly.
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
      if (rewritten !== m) changed = true;
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

/**
 * Walks an event payload, finds inline media parts in message content arrays,
 * externalizes them via `service.storeFromBytes`, and returns a new event
 * with the parts rewritten to reference stored objects by URL.
 *
 * Supports two event shapes:
 *  - Shape A: `event.message` (TEXT_MESSAGE_END) — one message.
 *  - Shape B: `event.messages[]` (MESSAGE_SNAPSHOT) — an array of messages.
 *
 * Behaviour:
 *  - If the event has no recognizable message field, returns it unchanged
 *    with an empty refs list.
 *  - If a content part fails AG-UI `InputContentSchema` validation, the
 *    whole message passes through unchanged ("degraded, not broken").
 *  - On `storeFromBytes` failure, the error is rethrown — the route maps
 *    it to a 5xx.
 *
 * Adding a new event shape with media content: implement a third dispatch
 * branch below; the per-message walker is reusable as-is.
 */
export async function extractInlineMediaFromEvent({
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
  service: StoredObjectsService;
}): Promise<{ rewrittenEvent: unknown; refs: ExtractedRef[] }> {
  return tracer.withActiveSpan(
    "StoredObjects.extractInlineMediaFromEvent",
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "tenant.id": projectId,
        "stored_objects.purpose": purpose,
        "stored_objects.owner_kind": ownerKind,
        // owner_id is customer-controlled (e.g. scenarioRunId). Acceptable here because tenant_id is also on the span and owner_id is low-entropy by design — operators running shared OTEL backends should be aware that this attribute is searchable across tenants if their backend doesn't enforce tenant-scoped queries.
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
        const { messages, refs, changed } = await rewriteMessageArray(
          eventObj.messages,
          params,
        );
        span.setAttribute("stored_objects.refs_extracted", refs.length);
        if (!changed) return { rewrittenEvent: event, refs };
        return { rewrittenEvent: { ...eventObj, messages }, refs };
      }

      span.setAttribute("stored_objects.refs_extracted", 0);
      return { rewrittenEvent: event, refs: [] };
    },
  );
}

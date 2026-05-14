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
import { z } from "zod";
import { createLogger } from "~/utils/logger/server";
import type { StoredObjectsService } from "./stored-objects.service";

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
// Public API
// ---------------------------------------------------------------------------

/**
 * Walks an event payload, finds inline media parts in message content arrays,
 * externalizes them via `service.storeFromBytes`, and returns a new event with
 * the parts rewritten to reference stored objects by URL.
 *
 * Behaviour:
 * - If the event has no `message` or `message.content` is not an array, returns
 *   the event unchanged with an empty refs list.
 * - If `message.content` exists but fails AG-UI `InputContentSchema` validation
 *   for individual parts, the event is returned unchanged (degraded fallback).
 * - On `storeFromBytes` failure, the error is rethrown (caller returns 5xx).
 *
 * @param event - A parsed scenarioEventSchema value.
 * @param projectId - The owning project's ID (tenant).
 * @param ownerKind - The entity kind that owns these objects (e.g. "scenario_run").
 * @param ownerId - The entity ID that owns these objects (e.g. the scenarioRunId).
 * @param purpose - Label for metrics/observability (e.g. "scenario_event").
 * @param service - The StoredObjectsService instance.
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
  // Only events with a `message` carrying an array content are eligible.
  if (
    typeof event !== "object" ||
    event === null ||
    !("message" in event) ||
    typeof (event as { message: unknown }).message !== "object" ||
    (event as { message: unknown }).message === null
  ) {
    return { rewrittenEvent: event, refs: [] };
  }

  const message = (event as { message: Record<string, unknown> }).message;

  if (!Array.isArray(message.content)) {
    return { rewrittenEvent: event, refs: [] };
  }

  const rawParts: unknown[] = message.content;

  // Attempt to parse each part through the AG-UI schema.
  // If any part fails to parse, bail out and return the event unchanged.
  const parsedParts: InputContentPart[] = [];
  for (const raw of rawParts) {
    const result = InputContentSchema.safeParse(raw);
    if (!result.success) {
      logger.debug(
        { error: result.error.message },
        "content part failed AG-UI parse — passing event through unchanged",
      );
      return { rewrittenEvent: event, refs: [] };
    }
    parsedParts.push(result.data);
  }

  // Walk each part sequentially — storage I/O is the bottleneck; no parallel needed.
  const rewrittenParts: InputContentPart[] = [];
  const refs: ExtractedRef[] = [];

  for (const part of parsedParts) {
    // storeFromBytes throws propagate out here — caller maps to 5xx.
    const { part: rewritten, ref } = await processContentPart({
      part,
      projectId,
      purpose,
      ownerKind,
      ownerId,
      service,
    });
    rewrittenParts.push(rewritten);
    if (ref !== null) {
      refs.push(ref);
    }
  }

  // Immutable rewrite — build a new event object
  const rewrittenEvent = {
    ...(event as object),
    message: {
      ...message,
      content: rewrittenParts,
    },
  };

  return { rewrittenEvent, refs };
}

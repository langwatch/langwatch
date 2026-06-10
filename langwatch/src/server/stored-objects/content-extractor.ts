/**
 * content-extractor.ts — walks scenario message payloads, externalizes inline media.
 *
 * For every message content part that carries inline byte data, this module:
 *  1. Decodes the base64 payload.
 *  2. Calls `service.storeFromBytes` to content-address the bytes.
 *  3. Rewrites the part to reference the stored object by URL.
 *
 * The walker speaks the langwatch tracer's `chatRichContentSchema` shape (the
 * production contract — see `src/server/tracer/types.ts`), not AG-UI's
 * `InputContentSchema`. The two vocabularies overlap on `binary` but diverge
 * on image carriers: production sends `{type:"image_url", image_url:{url}}`
 * (OpenAI-shaped, possibly a `data:` URI). The visitor's `legacyImageUrl`
 * branch handles that case.
 *
 * Shape rules:
 *  - `binary` with `data` set → extract, rewrite to `id + url + data:undefined`
 *  - `image_url` with `image_url.url` starting `data:` → extract, rewrite to
 *    `image_url.url = /api/files/<id>`
 *  - everything else (text, tool_call, tool_result, image_url with http URLs,
 *    bare image, unknown shapes) → pass through unchanged
 *
 * The walker is deliberately narrow: it only touches the fields it understands
 * and leaves everything else untouched ("degraded, not broken").
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { binaryInputPartSchema } from "./binary-part";
import { coerceContentToArray } from "./coerce-content-to-array";
import { isReadbackSafe } from "./safe-media-types";
import type { StoredObjectsService } from "./stored-objects.service";
import { visitContentPartAsync } from "./visit-content-part";

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

/**
 * Parse a `data:` URI into its mime type + base64 payload. Returns null when
 * the input isn't a `data:<mime>;base64,<...>` shape; non-base64 data URIs
 * (`data:<mime>,<urlencoded>`) are out of scope — extraction is for binary
 * payloads only, not for short URL-encoded text data.
 *
 * Spec: RFC 2397, but only the `base64` form. Examples we accept:
 *   data:image/png;base64,iVBORw0KGgo...
 *   data:audio/wav;base64,UklGR...
 */
function parseBase64DataUri(
  uri: string,
): { mimeType: string; base64: string } | null {
  if (!uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = uri.slice(5, commaIdx); // strip "data:"
  const payload = uri.slice(commaIdx + 1);
  if (!header.endsWith(";base64")) return null;
  const mimeType = header.slice(0, -7); // strip ";base64"
  if (!mimeType) return null;
  return { mimeType, base64: payload };
}

/**
 * Rewrites a single content part, storing any inline bytes via the service.
 * Returns the (possibly new) part and an optional ref. `part` is unknown
 * because the upstream walker no longer pre-validates against a single
 * schema — the visitor's shape-dispatch handles each variant directly.
 */
async function processContentPart({
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
  service: StoredObjectsService;
}): Promise<{ part: unknown; ref: ExtractedRef | null }> {
  type Out = { part: unknown; ref: ExtractedRef | null };
  const noOp: Out = { part, ref: null };

  const result = await visitContentPartAsync<Out>(part, {
    text: () => noOp,
    toolCall: () => noOp,
    toolResult: () => noOp,

    async media(mediaPart) {
      if (mediaPart.source.type !== "data") return noOp;

      const { value: base64, mimeType } = mediaPart.source;

      // For document parts, reject MIME types the read path can't faithfully
      // serve. The /api/files route downgrades anything outside the allowlist to
      // application/octet-stream, so text/csv, application/json, etc. would
      // ingest silently but come back as a blob download. Pass through unchanged
      // rather than corrupt the round-trip.
      if (mediaPart.type === "document" && !isReadbackSafe(mimeType)) {
        logger.debug(
          { mimeType },
          "document part has an unsafe MIME type — passing through unchanged",
        );
        return noOp;
      }

      const bytes = Buffer.from(base64, "base64");
      const stored = await service.storeFromBytes({
        projectId,
        purpose,
        ownerKind,
        ownerId,
        mediaType: mimeType,
        bytes,
      });

      const ref: ExtractedRef = {
        id: stored.id,
        isDuplicate: stored.isDuplicate,
        purpose,
        ownerKind,
        ownerId,
      };

      const rewrittenPart = {
        ...(part as Record<string, unknown>),
        source: { type: "url", value: `/api/files/${stored.id}`, mimeType },
      };

      return { part: rewrittenPart, ref };
    },

    async binary(binPart) {
      // Enforce exactly-one-of(data, url, id) at the boundary before touching.
      // AG-UI's InputContentSchema permits the ambiguous cases; rejecting them
      // here matches the runtime invariant the extractor depends on.
      const refined = binaryInputPartSchema.safeParse(binPart);
      if (!refined.success) {
        logger.debug(
          { error: refined.error.message },
          "binary part violates exactly-one-of(data,url,id); passing through unchanged",
        );
        return noOp;
      }

      if (
        binPart.data === undefined ||
        binPart.id !== undefined ||
        binPart.url !== undefined
      ) {
        return noOp;
      }

      const { data, mimeType } = binPart;
      const bytes = Buffer.from(data, "base64");
      const stored = await service.storeFromBytes({
        projectId,
        purpose,
        ownerKind,
        ownerId,
        mediaType: mimeType,
        bytes,
      });

      const ref: ExtractedRef = {
        id: stored.id,
        isDuplicate: stored.isDuplicate,
        purpose,
        ownerKind,
        ownerId,
      };

      const original = part as Record<string, unknown>;
      // AI-SDK file shape (`type:"file", mediaType, data`) is dispatched here
      // by the visitor when mimeType is not audio/*. Normalise to a clean
      // `binary` shape (the same canonical form the inputAudio handler
      // produces for the audio path) so the rewrite is not a chimera of
      // `type:"file"` + binary externalised fields.
      const isFileShape = original.type === "file";
      const rewrittenPart = isFileShape
        ? {
            type: "binary",
            mimeType,
            id: stored.id,
            url: `/api/files/${stored.id}`,
            data: undefined,
            ...(typeof original.filename === "string"
              ? { filename: original.filename }
              : {}),
          }
        : {
            ...original,
            id: stored.id,
            url: `/api/files/${stored.id}`,
            data: undefined,
          };

      return { part: rewrittenPart, ref };
    },

    // Production scenario messages use the OpenAI-shaped image_url variant.
    // Extract when the URL is a base64 data: URI; pass through http(s) URLs
    // unchanged (already externalized by the SDK, or pointing at an
    // external CDN we shouldn't re-host).
    async imageUrl(url) {
      const parsed = parseBase64DataUri(url);
      if (!parsed) return noOp;

      const { mimeType, base64 } = parsed;
      const bytes = Buffer.from(base64, "base64");
      const stored = await service.storeFromBytes({
        projectId,
        purpose,
        ownerKind,
        ownerId,
        mediaType: mimeType,
        bytes,
      });

      const ref: ExtractedRef = {
        id: stored.id,
        isDuplicate: stored.isDuplicate,
        purpose,
        ownerKind,
        ownerId,
      };

      const original = part as Record<string, unknown>;
      const originalImageUrl =
        typeof original.image_url === "object" && original.image_url !== null
          ? (original.image_url as Record<string, unknown>)
          : {};
      const rewrittenPart = {
        ...original,
        image_url: {
          ...originalImageUrl,
          url: `/api/files/${stored.id}`,
        },
      };

      return { part: rewrittenPart, ref };
    },

    // OpenAI Realtime API: {type:"input_audio", input_audio:{data:"<base64>", format:"wav"}}.
    // This is the shape the langwatch python-sdk emits for scenario audio
    // turns today, and the shape the typescript-sdk's
    // convert-core-messages-to-agui-messages translates AI-SDK file+audio
    // parts to. Mime type resolution priority: explicit `mimeType` (set by
    // the file-part dispatch path in visit-content-part for AI-SDK
    // `audio/pcm16` etc.) > format-to-mimeType allowlist > a final
    // `application/octet-stream` fallback when neither is recognised.
    async inputAudio(audioPart) {
      // Already-externalized: nothing to extract, pass through unchanged.
      if (!audioPart.data) return noOp;

      const format = audioPart.format?.toLowerCase();
      const mimeType =
        audioPart.mimeType ??
        (format === "wav"
          ? "audio/wav"
          : format === "mp3"
            ? "audio/mpeg"
            : format === "flac"
              ? "audio/flac"
              : format === "ogg"
                ? "audio/ogg"
                : format === "webm"
                  ? "audio/webm"
                  : "application/octet-stream");

      const bytes = Buffer.from(audioPart.data, "base64");
      const stored = await service.storeFromBytes({
        projectId,
        purpose,
        ownerKind,
        ownerId,
        mediaType: mimeType,
        bytes,
      });

      const ref: ExtractedRef = {
        id: stored.id,
        isDuplicate: stored.isDuplicate,
        purpose,
        ownerKind,
        ownerId,
      };

      const original = part as Record<string, unknown>;
      const isFileShape = original.type === "file";
      const originalInputAudio =
        typeof original.input_audio === "object" && original.input_audio !== null
          ? (original.input_audio as Record<string, unknown>)
          : {};

      // Rewrite to the canonical externalised `input_audio` shape so the UI
      // MediaPart renders a playable reference. When the inbound part was an
      // AI-SDK `file` shape (`{type:"file", mediaType, data}`), drop the
      // file-specific discriminants so the rewritten part is a clean
      // input_audio reference rather than a chimera of both shapes.
      const rewrittenPart = isFileShape
        ? {
            type: "input_audio",
            input_audio: {
              data: undefined,
              url: `/api/files/${stored.id}`,
              mimeType,
            },
          }
        : {
            ...original,
            input_audio: {
              ...originalInputAudio,
              data: undefined,
              url: `/api/files/${stored.id}`,
              mimeType,
            },
          };

      return { part: rewrittenPart, ref };
    },

    // Bare {image: "data:..."} is rare in production but seen in some
    // older fixtures. Handle the data-URI case symmetrically.
    async bareImage(src) {
      const parsed = parseBase64DataUri(src);
      if (!parsed) return noOp;

      const { mimeType, base64 } = parsed;
      const bytes = Buffer.from(base64, "base64");
      const stored = await service.storeFromBytes({
        projectId,
        purpose,
        ownerKind,
        ownerId,
        mediaType: mimeType,
        bytes,
      });

      const ref: ExtractedRef = {
        id: stored.id,
        isDuplicate: stored.isDuplicate,
        purpose,
        ownerKind,
        ownerId,
      };

      const rewrittenPart = {
        ...(part as Record<string, unknown>),
        image: `/api/files/${stored.id}`,
      };

      return { part: rewrittenPart, ref };
    },
  });

  return result ?? noOp;
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
 *   content array, or no part contained extractable bytes). Reference
 *   identity lets the event dispatcher above detect "no-op" without
 *   diffing the bytes.
 * - On `storeFromBytes` failure, the error propagates out — the caller
 *   maps it to a 5xx and rolls back the event.
 *
 * No upstream Zod gate: each part is dispatched to the visitor by shape,
 * unknown shapes pass through unchanged. This is intentionally lenient
 * because the production message vocabulary (`chatRichContentSchema` —
 * see `src/server/tracer/types.ts`) covers more variants than any single
 * library schema, including `image_url` with data URIs.
 */
async function rewriteMessage(
  rawMessage: Record<string, unknown>,
  params: ExtractionParams,
): Promise<{ message: Record<string, unknown>; refs: ExtractedRef[] }> {
  const contentArray = coerceContentToArray(rawMessage.content);
  if (contentArray === null) {
    return { message: rawMessage, refs: [] };
  }

  const refs: ExtractedRef[] = [];
  const rewrittenParts: unknown[] = [];
  let changed = false;
  for (const raw of contentArray) {
    const { part: rewritten, ref } = await processContentPart({
      part: raw,
      ...params,
    });
    if (rewritten !== raw) changed = true;
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

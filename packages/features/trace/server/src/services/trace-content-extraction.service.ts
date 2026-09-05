/**
 * Walks scenario message payloads, externalizing inline media: decodes base64, calls storeFromBytes to content-address the bytes, rewrites the part to reference the stored object by URL. Speaks the tracer's chatRichContentSchema shape (production contract), not AG-UI's InputContentSchema — they overlap on binary but diverge on image carriers (production's OpenAI-shaped image_url with a data: URI, handled by legacyImageUrl). binary with data set extracts to id+url+data:undefined; image_url with a data: URI extracts to image_url.url=/api/files/<projectId>/<id> — minted URLs carry the owning projectId (#4947) so the read route resolves ownership directly, no cross-tenant lookup (legacy id-only URLs stay resolvable via the retained fallback). Everything else passes through unchanged ("degraded, not broken") — the walker only touches fields it understands.
 */

import { z } from "zod";
import { TraceContentArrayService } from "./trace-content-array.service";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { resolveRawPcmFormat, wrapRawPcmToWav } from "@langwatch/trace-contract";
import {
  isInlineDataCarrier,
  parseBase64DataUri,
  visitContentPartAsync,
} from "@langwatch/trace-contract";
import { isReadbackSafe } from "@langwatch/stored-object-contract";

/**
 * Runtime invariant: an AG-UI binary content part must carry exactly one of data, url, or id — anything else is structurally ambiguous and the extractor would do the wrong thing depending on which field it checked first. The shared chatRichContentSchema only checks each field is string-or-absent; mutual exclusion is a stricter ingest-time constraint wrapped here so the extractor and the scenario-events route can both call it.
 */

export const binaryInputPartSchema = z
  .object({
    type: z.literal("binary"),
    mimeType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
    filename: z.string().optional(),
  })
  .refine(
    (part) => {
      const present =
        Number(part.data !== undefined) +
        Number(part.url !== undefined) +
        Number(part.id !== undefined);

      return present === 1;
    },
    {
      message: "binary part must carry exactly one of data, url, or id (got zero or more than one)",
    },
  );

export type BinaryInputPart = z.infer<typeof binaryInputPartSchema>;
import type { TraceMediaStorePort } from "../ports/trace-media-store.port";

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

// ---------------------------------------------------------------------------
// Per-message walker
// ---------------------------------------------------------------------------

interface ExtractionParams {
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: TraceMediaStorePort;
}

/**
 * Walks a single message's content array, externalizing inline media. Returns the same message reference when nothing was rewritten, so the dispatcher can detect a no-op without diffing bytes; on storeFromBytes failure the error propagates (caller maps to 5xx, rolls back the event). No upstream Zod gate — each part dispatches to the visitor by shape, unknown shapes pass through, intentionally lenient since production's chatRichContentSchema covers more variants than any single library schema (incl. image_url with data URIs).
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
 * Walks every message in an event's messages array. Returns the original messages reference (and empty refs) when no message changed, preserving identity at the event level so the dispatcher can short-circuit cleanly.
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

export class TraceContentExtractionService {
  static create(): TraceContentExtractionService {
    return new TraceContentExtractionService();
  }

  /**
   * Rewrites a single content part, storing inline bytes via the service. Returns the (possibly new) part and an optional ref; part is unknown since the upstream walker no longer pre-validates against one schema — the visitor's shape-dispatch handles each variant. Exported for the generic value walker (value-media-extractor.ts), which finds media in arbitrary JSON (span attributes), not the scenario event envelope.
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
    service: TraceMediaStorePort;
  }): Promise<{ part: unknown; ref: ExtractedRef | null }> {
    type Out = { part: unknown; ref: ExtractedRef | null };
    const noOp: Out = { part, ref: null };

    const result = await visitContentPartAsync<Out>(part, {
      text: () => noOp,
      toolCall: () => noOp,
      toolResult: () => noOp,

      async media(mediaPart) {
        if (mediaPart.source.type !== "data") {
          return noOp;
        }

        const { value: base64, mimeType } = mediaPart.source;
        // A source with no media type is not extractable: the read path serves
        // whatever we store it as, so bytes with no declared type come back as
        // an octet-stream download rather than a picture or a player.
        if (typeof base64 !== "string" || typeof mimeType !== "string") {
          return noOp;
        }

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

        const source = {
          type: "url",
          value: `/api/files/${projectId}/${stored.id}`,
          mimeType,
        };
        // A Gemini `inline_data` part keeps its bytes in its own carrier key,
        // not in `source`, so adding a `source` would leave the base64 in place.
        // Rewrite those to the canonical media shape, which drops the carrier.
        const rewrittenPart = isInlineDataCarrier(part)
          ? { type: mediaPart.type, source }
          : { ...(part as Record<string, unknown>), source };

        return { part: rewrittenPart, ref };
      },

      async binary(binPart) {
        // Unlike the media/document handler above, this path has no
        // isReadbackSafe gate: binary parts render as a download chip, not
        // inline, so a non-allowlisted type still round-trips the exact
        // bytes with its original filename. Enforces exactly-one-of(data,
        // url, id) at the boundary, matching the runtime invariant the extractor depends on.
        const refined = binaryInputPartSchema.safeParse(binPart);
        if (!refined.success) {
          logger.debug(
            { error: refined.error.message },
            "binary part violates exactly-one-of(data,url,id); passing through unchanged",
          );

          return noOp;
        }

        if (binPart.data === undefined || binPart.id !== undefined || binPart.url !== undefined) {
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
        // File shapes (AI-SDK {type:"file", mediaType, data}; OpenAI
        // {type:"file", file:{file_data, filename}}) are dispatched here
        // when mime type isn't audio/*. Normalises to the same clean binary
        // shape the inputAudio handler produces, so the rewrite isn't a
        // chimera of type:"file" + binary fields; filename is already resolved by the visitor.
        const isFileShape = original.type === "file";
        const rewrittenPart = isFileShape
          ? {
              type: "binary",
              mimeType,
              id: stored.id,
              url: `/api/files/${projectId}/${stored.id}`,
              data: undefined,
              ...(typeof binPart.filename === "string" ? { filename: binPart.filename } : {}),
            }
          : {
              ...original,
              id: stored.id,
              url: `/api/files/${projectId}/${stored.id}`,
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
        if (!parsed) {
          return noOp;
        }

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
            url: `/api/files/${projectId}/${stored.id}`,
          },
        };

        return { part: rewrittenPart, ref };
      },

      // OpenAI Realtime API: {type:"input_audio", input_audio:{data,
      // format:"wav"}} — the shape python-sdk emits for scenario audio
      // turns, and what convert-core-messages-to-agui-messages produces
      // from AI-SDK file+audio parts. Mime priority: explicit mimeType >
      // format-to-mimeType allowlist > application/octet-stream fallback.
      async inputAudio(audioPart) {
        // Already-externalized: nothing to extract, pass through unchanged.
        if (!audioPart.data) {
          return noOp;
        }

        const format = audioPart.format?.toLowerCase();
        let mimeType =
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

        let bytes = Buffer.from(audioPart.data, "base64");

        // Raw, header-less realtime formats (pcm16, G.711) are unplayable
        // served back as-is (no container, <audio> rejects them). Wrapped
        // into a WAV container AT STORE TIME so the externalized reference
        // is playable everywhere, identically on scenario and trace
        // extraction paths, so the same recording hashes to one object.
        const rawFormat = resolveRawPcmFormat(format, mimeType);
        if (rawFormat) {
          const wrapped = wrapRawPcmToWav(new Uint8Array(bytes), rawFormat);
          if (wrapped) {
            bytes = Buffer.from(wrapped);
            mimeType = "audio/wav";
          }
        }

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
                url: `/api/files/${projectId}/${stored.id}`,
                mimeType,
              },
            }
          : {
              ...original,
              input_audio: {
                ...originalInputAudio,
                data: undefined,
                url: `/api/files/${projectId}/${stored.id}`,
                mimeType,
              },
            };

        return { part: rewrittenPart, ref };
      },

      // Bare {image: "data:..."} is rare in production but seen in some
      // older fixtures. Handle the data-URI case symmetrically.
      async bareImage(src) {
        const parsed = parseBase64DataUri(src);
        if (!parsed) {
          return noOp;
        }

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
          image: `/api/files/${projectId}/${stored.id}`,
        };

        return { part: rewrittenPart, ref };
      },
    });

    return result ?? noOp;
  }

  /**
   * Walks an event payload, finds inline media in message content arrays, externalizes via storeFromBytes, returns a new event with parts rewritten to reference stored objects by URL. Supports event.message (TEXT_MESSAGE_END, one message) and event.messages[] (MESSAGE_SNAPSHOT, an array). No recognizable message field returns the event unchanged with empty refs; a part failing AG-UI InputContentSchema passes the whole message through unchanged ("degraded, not broken"); a storeFromBytes failure rethrows (route maps to 5xx). Adding a new event shape: implement a third dispatch branch — the per-message walker is reusable as-is.
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
    service: TraceMediaStorePort;
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

/**
 * How one content part's inline bytes become a stored object: where they land, what the rewritten
 * part looks like for each shape an emitter may send, and the one place a mime type is decided.
 * Pure apart from the store it is handed, so the dispatcher stays a table of shapes.
 */

import { parseBase64DataUri } from "@langwatch/trace-contract";
import { isReadbackSafe } from "@langwatch/stored-object-contract";
import { resolveRawPcmFormat, wrapRawPcmToWav } from "@langwatch/trace-contract";
import { isInlineDataCarrier } from "@langwatch/trace-contract";
import type { TraceMediaStorePort } from "../ports/trace-media-store.port.ts";
import { z } from "zod";

/**
 * Runtime invariant: a binary content part must carry exactly one of data, url or id, since
 * anything else is structurally ambiguous and the extractor would act on whichever field it
 * checked first. The shared schema only checks each is string-or-absent, so this is stricter.
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

/** Container mime types for the realtime audio formats we can name. */
const AUDIO_FORMAT_MIME_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  webm: "audio/webm",
};
/** What every part handler is given: the part itself and where its bytes should land. */
export interface ExtractionContext {
  part: unknown;
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: TraceMediaStorePort;
  /** Where a pass-through decision is recorded; structural so this module names no logger. */
  logger: { debug: (data: Record<string, unknown>, message: string) => void };
}

/** One part as it comes back: rewritten when its bytes moved, and the reference they moved to. */
export interface ExtractedPart {
  part: unknown;
  ref: ExtractedRef | null;
}

/** Stores one part's bytes and answers with the reference and the URL that now stands for them. */
export async function storePartBytes(
  context: ExtractionContext,
  { bytes, mimeType }: { bytes: Buffer; mimeType: string },
): Promise<{ ref: ExtractedRef; url: string }> {
  const { projectId, purpose, ownerKind, ownerId, service } = context;
  const stored = await service.storeFromBytes({
    projectId,
    purpose,
    ownerKind,
    ownerId,
    mediaType: mimeType,
    bytes,
  });

  return {
    ref: { id: stored.id, isDuplicate: stored.isDuplicate, purpose, ownerKind, ownerId },
    url: `/api/files/${projectId}/${stored.id}`,
  };
}

/**
 * A media or document part. A source with no media type is not extractable: the read path serves
 * whatever we store, so bytes with no declared type come back as an octet-stream download rather
 * than a picture or a player. A document type the read path would downgrade passes through whole.
 */
export async function extractMediaPart(
  context: ExtractionContext,
  mediaPart: { type: string; source: { type: string; value?: unknown; mimeType?: unknown } },
): Promise<ExtractedPart> {
  const noOp: ExtractedPart = { part: context.part, ref: null };
  if (mediaPart.source.type !== "data") {
    return noOp;
  }

  const { value: base64, mimeType } = mediaPart.source;
  if (typeof base64 !== "string" || typeof mimeType !== "string") {
    return noOp;
  }

  if (mediaPart.type === "document" && !isReadbackSafe(mimeType)) {
    context.logger.debug(
      { mimeType },
      "document part has an unsafe MIME type — passing through unchanged",
    );

    return noOp;
  }

  const { ref, url } = await storePartBytes(context, {
    bytes: Buffer.from(base64, "base64"),
    mimeType,
  });
  const source = { type: "url", value: url, mimeType };
  // A Gemini `inline_data` part keeps its bytes in its own carrier key rather than in `source`, so
  // adding a `source` would leave the base64 in place. Those rewrite to the canonical media shape,
  // which drops the carrier.
  const rewrittenPart = isInlineDataCarrier(context.part)
    ? { type: mediaPart.type, source }
    : { ...(context.part as Record<string, unknown>), source };

  return { part: rewrittenPart, ref };
}

/**
 * A binary part. Unlike a media part there is no readback-safety gate: binary parts render as a
 * download chip rather than inline, so a non-allowlisted type still round-trips its exact bytes
 * under its original filename. Exactly one of data, url and id must be set.
 */
export async function extractBinaryPart(
  context: ExtractionContext,
  binPart: BinaryInputPart,
): Promise<ExtractedPart> {
  const noOp: ExtractedPart = { part: context.part, ref: null };
  const refined = binaryInputPartSchema.safeParse(binPart);
  if (!refined.success) {
    context.logger.debug(
      { error: refined.error.message },
      "binary part violates exactly-one-of(data,url,id); passing through unchanged",
    );

    return noOp;
  }

  if (binPart.data === undefined || binPart.id !== undefined || binPart.url !== undefined) {
    return noOp;
  }

  const { data, mimeType } = binPart;
  const { ref, url } = await storePartBytes(context, {
    bytes: Buffer.from(data, "base64"),
    mimeType,
  });
  const original = context.part as Record<string, unknown>;
  // A file shape arrives here whenever its mime type is not audio. It normalises to the same clean
  // binary shape the audio handler produces, so the rewrite is not a chimera of both.
  const rewrittenPart =
    original.type === "file"
      ? {
          type: "binary",
          mimeType,
          id: ref.id,
          url,
          data: undefined,
          ...(typeof binPart.filename === "string" ? { filename: binPart.filename } : {}),
        }
      : { ...original, id: ref.id, url, data: undefined };

  return { part: rewrittenPart, ref };
}

/**
 * The OpenAI-shaped `image_url` variant production scenario messages use. Only a base64 data URI
 * is extracted; an http URL is already externalized, or points at a CDN we should not re-host.
 */
export async function extractImageUrlPart(
  context: ExtractionContext,
  imageUrl: string,
): Promise<ExtractedPart> {
  const parsed = parseBase64DataUri(imageUrl);
  if (!parsed) {
    return { part: context.part, ref: null };
  }

  const { ref, url } = await storePartBytes(context, {
    bytes: Buffer.from(parsed.base64, "base64"),
    mimeType: parsed.mimeType,
  });
  const original = context.part as Record<string, unknown>;
  const originalImageUrl =
    typeof original.image_url === "object" && original.image_url !== null
      ? (original.image_url as Record<string, unknown>)
      : {};

  return { part: { ...original, image_url: { ...originalImageUrl, url } }, ref };
}

/**
 * The OpenAI realtime `input_audio` shape. Mime type comes from the part, then the format
 * allowlist, then an octet-stream fallback. Raw header-less formats are wrapped into a WAV
 * container at store time, identically on every extraction path, so one recording hashes once.
 */
export async function extractInputAudioPart(
  context: ExtractionContext,
  audioPart: { data?: string; format?: string; mimeType?: string },
): Promise<ExtractedPart> {
  if (!audioPart.data) {
    return { part: context.part, ref: null };
  }

  const format = audioPart.format?.toLowerCase();
  let mimeType = audioPart.mimeType ?? (format ? AUDIO_FORMAT_MIME_TYPES[format] : void 0);
  mimeType ??= "application/octet-stream";
  let bytes = Buffer.from(audioPart.data, "base64");
  const rawFormat = resolveRawPcmFormat(format, mimeType);
  if (rawFormat) {
    const wrapped = wrapRawPcmToWav(new Uint8Array(bytes), rawFormat);
    if (wrapped) {
      bytes = Buffer.from(wrapped);
      mimeType = "audio/wav";
    }
  }

  const { ref, url } = await storePartBytes(context, { bytes, mimeType });
  const original = context.part as Record<string, unknown>;
  const originalInputAudio =
    typeof original.input_audio === "object" && original.input_audio !== null
      ? (original.input_audio as Record<string, unknown>)
      : {};
  // The canonical externalised shape, so the viewer renders a playable reference. An inbound file
  // shape drops its file-specific discriminants rather than becoming a chimera of both.
  const rewrittenPart =
    original.type === "file"
      ? { type: "input_audio", input_audio: { data: undefined, url, mimeType } }
      : {
          ...original,
          input_audio: { ...originalInputAudio, data: undefined, url, mimeType },
        };

  return { part: rewrittenPart, ref };
}

/** A bare `{image: "data:..."}`, rare in production but present in older fixtures. */
export async function extractBareImagePart(
  context: ExtractionContext,
  src: string,
): Promise<ExtractedPart> {
  const parsed = parseBase64DataUri(src);
  if (!parsed) {
    return { part: context.part, ref: null };
  }

  const { ref, url } = await storePartBytes(context, {
    bytes: Buffer.from(parsed.base64, "base64"),
    mimeType: parsed.mimeType,
  });

  return { part: { ...(context.part as Record<string, unknown>), image: url }, ref };
}

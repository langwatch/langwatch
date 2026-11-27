/**
 * What one content part's inline bytes are, and what the part reads once they are stored: one
 * extraction and one rewrite per shape an emitter may send, and the one place a media type is
 * decided. Pure: the store phase lives in the extraction service.
 */

import { isReadbackSafe } from "@langwatch/stored-object-contract";
import {
  detectRawPcmFormat,
  encodeRawPcmAsWav,
  isInlineDataCarrier,
  parseBase64DataUri,
  visitContentPart,
} from "@langwatch/trace-contract";
import { z } from "zod";

/** A binary part must carry exactly one of data, url or id; the shared schema checks less. */
const binaryInputPartSchema = z
  .object({
    type: z.literal("binary"),
    mimeType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
    filename: z.string().optional(),
  })
  .refine(
    (part) =>
      Number(part.data !== undefined) +
        Number(part.url !== undefined) +
        Number(part.id !== undefined) ===
      1,
  );

type BinaryInputPart = z.infer<typeof binaryInputPartSchema>;

/** Container media types for the realtime audio formats we can name. */
const AUDIO_FORMAT_MEDIA_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

/** Where a part's bytes went: the persisted reference string and the stored object id. */
export type StoredMediaPart = Readonly<{ reference: string; storedObjectId: string }>;

/**
 * A part's inline bytes, the media type to store them under and the part once they are stored;
 * or `none` when the part carries nothing to move.
 */
export type MediaPartExtraction =
  | Readonly<{
      kind: "inline";
      bytes: Buffer;
      mediaType: string;
      rewrite: (stored: StoredMediaPart) => unknown;
    }>
  | Readonly<{ kind: "none" }>;

const NO_INLINE_BYTES: MediaPartExtraction = { kind: "none" };

type MediaPartShape = {
  type: string;
  source: { type: string; value?: unknown; mimeType?: unknown };
};

/** A media or document part, re-pointed at its stored reference. */
export function rewriteMediaPart({
  part,
  partType,
  reference,
  mediaType,
}: {
  part: unknown;
  partType: string;
  reference: string;
  mediaType: string;
}): unknown {
  const source = { type: "url", value: reference, mimeType: mediaType };
  // A Gemini `inline_data` part keeps its bytes in its own carrier key, so it rewrites to the
  // canonical media shape, which drops the carrier.
  return isInlineDataCarrier(part)
    ? { type: partType, source }
    : { ...(part as Record<string, unknown>), source };
}

/** A binary part (or a non-audio file part, normalised to binary), re-pointed at its object. */
export function rewriteBinaryPart({
  part,
  reference,
  storedObjectId,
  mediaType,
  filename,
}: {
  part: unknown;
  reference: string;
  storedObjectId: string;
  mediaType: string;
  filename: string | undefined;
}): unknown {
  const original = part as Record<string, unknown>;
  if (original.type === "file") {
    return {
      type: "binary",
      mimeType: mediaType,
      id: storedObjectId,
      url: reference,
      data: undefined,
      ...(typeof filename === "string" ? { filename } : {}),
    };
  }

  return { ...original, id: storedObjectId, url: reference, data: undefined };
}

/** An OpenAI-shaped `image_url` part, re-pointed at its stored reference. */
export function rewriteImageUrlPart({
  part,
  reference,
}: {
  part: unknown;
  reference: string;
}): unknown {
  const original = part as Record<string, unknown>;
  const originalImageUrl =
    typeof original.image_url === "object" && original.image_url !== null
      ? (original.image_url as Record<string, unknown>)
      : {};

  return { ...original, image_url: { ...originalImageUrl, url: reference } };
}

/** An `input_audio` part (or an audio file part, normalised to it), re-pointed at its object. */
export function rewriteInputAudioPart({
  part,
  reference,
  mediaType,
}: {
  part: unknown;
  reference: string;
  mediaType: string;
}): unknown {
  const original = part as Record<string, unknown>;
  if (original.type === "file") {
    return {
      type: "input_audio",
      input_audio: { data: undefined, url: reference, mimeType: mediaType },
    };
  }

  const originalInputAudio =
    typeof original.input_audio === "object" && original.input_audio !== null
      ? (original.input_audio as Record<string, unknown>)
      : {};

  return {
    ...original,
    input_audio: { ...originalInputAudio, data: undefined, url: reference, mimeType: mediaType },
  };
}

/** A bare `{image: "data:..."}` part, re-pointed at its stored reference. */
export function rewriteBareImagePart({
  part,
  reference,
}: {
  part: unknown;
  reference: string;
}): unknown {
  return { ...(part as Record<string, unknown>), image: reference };
}

/**
 * A media part with no media type, or a document type the read path would downgrade, is not
 * extracted: the read path serves what we store, so it would come back as a download.
 */
function mediaExtraction(part: unknown, mediaPart: MediaPartShape): MediaPartExtraction {
  if (mediaPart.source.type !== "data") return NO_INLINE_BYTES;
  const { value: base64, mimeType } = mediaPart.source;
  if (typeof base64 !== "string" || typeof mimeType !== "string") return NO_INLINE_BYTES;
  if (mediaPart.type === "document" && !isReadbackSafe(mimeType)) return NO_INLINE_BYTES;

  return {
    kind: "inline",
    bytes: Buffer.from(base64, "base64"),
    mediaType: mimeType,
    rewrite: ({ reference }) =>
      rewriteMediaPart({ part, partType: mediaPart.type, reference, mediaType: mimeType }),
  };
}

/** No readback gate: a binary part renders as a download chip, so any type round-trips. */
function binaryExtraction(part: unknown, binPart: BinaryInputPart): MediaPartExtraction {
  if (!binaryInputPartSchema.validate(binPart)) return NO_INLINE_BYTES;
  if (binPart.data === undefined || binPart.id !== undefined || binPart.url !== undefined) {
    return NO_INLINE_BYTES;
  }

  const { data, mimeType, filename } = binPart;

  return {
    kind: "inline",
    bytes: Buffer.from(data, "base64"),
    mediaType: mimeType,
    rewrite: ({ reference, storedObjectId }) =>
      rewriteBinaryPart({ part, reference, storedObjectId, mediaType: mimeType, filename }),
  };
}

/** Only a base64 data URI moves; an http URL is already external, or a CDN we do not re-host. */
function dataUriExtraction(
  uri: string,
  rewrite: (reference: string) => unknown,
): MediaPartExtraction {
  const parsed = parseBase64DataUri(uri);
  if (!parsed) return NO_INLINE_BYTES;

  return {
    kind: "inline",
    bytes: Buffer.from(parsed.base64, "base64"),
    mediaType: parsed.mimeType,
    rewrite: ({ reference }) => rewrite(reference),
  };
}

/**
 * The media type comes from the part, then the format allowlist, then octet-stream. Raw
 * header-less audio is wrapped into WAV here, identically on every path, so it hashes once.
 */
function inputAudioExtraction(
  part: unknown,
  audioPart: { data?: string; format?: string; mimeType?: string },
): MediaPartExtraction {
  if (!audioPart.data) return NO_INLINE_BYTES;
  const format = audioPart.format?.toLowerCase();
  let mediaType =
    audioPart.mimeType ??
    (format ? AUDIO_FORMAT_MEDIA_TYPES[format] : undefined) ??
    "application/octet-stream";
  let bytes = Buffer.from(audioPart.data, "base64");
  const rawFormat = detectRawPcmFormat(format, mediaType);
  const wrapped = rawFormat ? encodeRawPcmAsWav(new Uint8Array(bytes), rawFormat) : undefined;
  if (wrapped) {
    bytes = Buffer.from(wrapped);
    mediaType = "audio/wav";
  }

  const storedMediaType = mediaType;

  return {
    kind: "inline",
    bytes,
    mediaType: storedMediaType,
    rewrite: ({ reference }) =>
      rewriteInputAudioPart({ part, reference, mediaType: storedMediaType }),
  };
}

/** The inline bytes `part` carries and how it reads once stored; `none` when nothing moves. */
export function mediaPartExtractionOf(part: unknown): MediaPartExtraction {
  return (
    visitContentPart<MediaPartExtraction>(part, {
      text: () => NO_INLINE_BYTES,
      toolCall: () => NO_INLINE_BYTES,
      toolResult: () => NO_INLINE_BYTES,
      media: (mediaPart) => mediaExtraction(part, mediaPart),
      binary: (binPart) => binaryExtraction(part, binPart as BinaryInputPart),
      imageUrl: (url) =>
        dataUriExtraction(url, (reference) => rewriteImageUrlPart({ part, reference })),
      inputAudio: (audioPart) => inputAudioExtraction(part, audioPart),
      bareImage: (src) =>
        dataUriExtraction(src, (reference) => rewriteBareImagePart({ part, reference })),
    }) ?? NO_INLINE_BYTES
  );
}

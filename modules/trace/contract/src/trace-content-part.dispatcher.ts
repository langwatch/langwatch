import {
  decodeOpenAiFilePayloadToBinaryPart,
  mapMediaTypeToAudioFormat,
} from "./trace-content-part.file-decoder.ts";
import { toMediaPart } from "./trace-content-part.provider-source.ts";
import { parseRecord } from "./trace-content-part.record-schema.ts";
import type { AsyncContentPartVisitor, ContentPartVisitor } from "./trace-content-part.types.ts";

/** The tool name a `tool_use` / `tool_call` part carries, under either spelling. */
function toolCallName(o: Record<string, unknown>): string {
  if (typeof o.name === "string") return o.name;
  if (typeof o.toolName === "string") return o.toolName;

  return "tool";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * What every shape falls back to: a bare `image` string, then the visitor's own `unknown`. A
 * shape that recognises its `type` but not its payload lands here too.
 */
function visitUnclaimedPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof o.image === "string" && o.image) {
    const src = o.image;
    return visitor.bareImage ? visitor.bareImage(src) : visitor.unknown?.(part);
  }

  return visitor.unknown?.(part);
}

function visitTextPart<R>(
  o: Record<string, unknown>,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const contentText = typeof o.content === "string" ? o.content : "";

  return visitor.text(typeof o.text === "string" ? o.text : contentText);
}

function visitInputAudioPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const ia = parseRecord(o.input_audio);
  if (!ia) return visitor.unknown?.(part);

  const data = asString(ia.data);
  const url = asString(ia.url);
  if (!data && !url) return visitUnclaimedPart(o, part, visitor);
  if (!visitor.inputAudio) return visitor.unknown?.(part);

  return visitor.inputAudio({
    data,
    url,
    format: asString(ia.format),
    mimeType: asString(ia.mimeType),
  });
}

/** A `file` part carrying its payload inline, under `mediaType` + `data`/`url`. */
function visitInlineFilePart<R>({
  o,
  part,
  visitor,
  payload,
}: {
  o: Record<string, unknown>;
  part: unknown;
  visitor: AsyncContentPartVisitor<R>;
  payload: Readonly<{ mimeType: string; data: string | undefined; url: string | undefined }>;
}): R | Promise<R> | undefined {
  const { mimeType, data, url } = payload;
  if (mimeType.startsWith("audio/")) {
    if (!visitor.inputAudio) return visitor.unknown?.(part);

    return visitor.inputAudio({ data, url, format: mapMediaTypeToAudioFormat(mimeType), mimeType });
  }

  return visitor.binary({
    type: "binary",
    mimeType,
    data,
    url,
    id: asString(o.id),
    filename: asString(o.filename),
  });
}

/** OpenAI's own shape: the payload sits under `file`, base64 with a filename. */
function visitOpenAiFilePart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const file = parseRecord(o.file);
  if (!file) return visitor.unknown?.(part);

  const binPart = decodeOpenAiFilePayloadToBinaryPart(file);
  if (!binPart) return visitor.unknown?.(part);
  if (!binPart.mimeType.startsWith("audio/")) return visitor.binary(binPart);
  if (!visitor.inputAudio) return visitor.unknown?.(part);

  return visitor.inputAudio({
    data: binPart.data,
    format: mapMediaTypeToAudioFormat(binPart.mimeType),
    mimeType: binPart.mimeType,
  });
}

function visitFilePart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof o.mediaType === "string") {
    const data = asString(o.data);
    const url = asString(o.url);
    if (data || url) {
      return visitInlineFilePart({
        o,
        part,
        visitor,
        payload: { mimeType: o.mediaType.toLowerCase(), data, url },
      });
    }
  }

  return visitOpenAiFilePart(o, part, visitor);
}

function visitBinaryPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof o.mimeType !== "string") return visitUnclaimedPart(o, part, visitor);

  return visitor.binary({
    type: "binary",
    mimeType: o.mimeType,
    data: asString(o.data),
    url: asString(o.url),
    id: asString(o.id),
    filename: asString(o.filename),
  });
}

function visitImageUrlPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const url = extractImageUrlFromPart(o);
  if (url === null) return visitUnclaimedPart(o, part, visitor);

  return visitor.imageUrl ? visitor.imageUrl(url) : visitor.unknown?.(part);
}

function visitRecordPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (o.type === "text" || (!o.type && o.text)) return visitTextPart(o, visitor);

  const mediaPart = toMediaPart(o);
  if (mediaPart) return visitor.media(mediaPart);

  switch (o.type) {
    case "input_audio":
      return visitInputAudioPart(o, part, visitor);
    case "file":
      return visitFilePart(o, part, visitor);
    case "binary":
      return visitBinaryPart(o, part, visitor);
    case "tool_use":
    case "tool_call":
      return visitor.toolCall({
        name: toolCallName(o),
        arguments: o.arguments ?? o.input ?? o.args,
      });
    case "tool_result":
      return visitor.toolResult({ result: o.content ?? o.result });
    case "image_url":
      return visitImageUrlPart(o, part, visitor);
    default:
      return visitUnclaimedPart(o, part, visitor);
  }
}

export function visitAnyContentPart<R>(
  part: unknown,
  visitor: ContentPartVisitor<R>,
): R | undefined;
export function visitAnyContentPart<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined;
export function visitAnyContentPart<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof part === "string") {
    return visitor.text(part);
  }

  const o = parseRecord(part);
  if (!o) {
    return visitor.unknown?.(part);
  }

  return visitRecordPart(o, part, visitor);
}

export function visitContentPart<R>(part: unknown, visitor: ContentPartVisitor<R>): R | undefined {
  return visitAnyContentPart(part, visitor);
}

function extractImageUrlFromPart(o: Record<string, unknown>): string | null {
  if (o.type !== "image_url") return null;
  const carrier = o.image_url;
  if (typeof carrier === "string" && carrier) return carrier;
  const record = parseRecord(carrier);
  return record && typeof record.url === "string" ? record.url : null;
}

import {
  openAiFilePayloadToBinaryPart,
  mediaTypeToAudioFormat,
} from "./trace-content-part.file-decoder.ts";
import { toMediaPart } from "./trace-content-part.provider-source.ts";
import { tryParseRecord } from "./trace-content-part.record-schema.ts";
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
function unclaimedPart<R>(
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

function textPart<R>(
  o: Record<string, unknown>,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const contentText = typeof o.content === "string" ? o.content : "";

  return visitor.text(typeof o.text === "string" ? o.text : contentText);
}

function inputAudioPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const ia = tryParseRecord(o.input_audio);
  if (!ia) return visitor.unknown?.(part);

  const data = asString(ia.data);
  const url = asString(ia.url);
  if (!data && !url) return unclaimedPart(o, part, visitor);
  if (!visitor.inputAudio) return visitor.unknown?.(part);

  return visitor.inputAudio({
    data,
    url,
    format: asString(ia.format),
    mimeType: asString(ia.mimeType),
  });
}

/** A `file` part carrying its payload inline, under `mediaType` + `data`/`url`. */
function inlineFilePart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
  payload: Readonly<{ mimeType: string; data: string | undefined; url: string | undefined }>,
): R | Promise<R> | undefined {
  const { mimeType, data, url } = payload;
  if (mimeType.startsWith("audio/")) {
    if (!visitor.inputAudio) return visitor.unknown?.(part);

    return visitor.inputAudio({ data, url, format: mediaTypeToAudioFormat(mimeType), mimeType });
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
function openAiFilePart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const file = tryParseRecord(o.file);
  if (!file) return visitor.unknown?.(part);

  const binPart = openAiFilePayloadToBinaryPart(file);
  if (!binPart) return visitor.unknown?.(part);
  if (!binPart.mimeType.startsWith("audio/")) return visitor.binary(binPart);
  if (!visitor.inputAudio) return visitor.unknown?.(part);

  return visitor.inputAudio({
    data: binPart.data,
    format: mediaTypeToAudioFormat(binPart.mimeType),
    mimeType: binPart.mimeType,
  });
}

function filePart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof o.mediaType === "string") {
    const data = asString(o.data);
    const url = asString(o.url);
    if (data || url) {
      return inlineFilePart(o, part, visitor, { mimeType: o.mediaType.toLowerCase(), data, url });
    }
  }

  return openAiFilePart(o, part, visitor);
}

function binaryPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof o.mimeType !== "string") return unclaimedPart(o, part, visitor);

  return visitor.binary({
    type: "binary",
    mimeType: o.mimeType,
    data: asString(o.data),
    url: asString(o.url),
    id: asString(o.id),
    filename: asString(o.filename),
  });
}

function imageUrlPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  const url = imageUrlFromPart(o);
  if (url === null) return unclaimedPart(o, part, visitor);

  return visitor.imageUrl ? visitor.imageUrl(url) : visitor.unknown?.(part);
}

function dispatchRecordPart<R>(
  o: Record<string, unknown>,
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (o.type === "text" || (!o.type && o.text)) return textPart(o, visitor);

  const mediaPart = toMediaPart(o);
  if (mediaPart) return visitor.media(mediaPart);

  switch (o.type) {
    case "input_audio":
      return inputAudioPart(o, part, visitor);
    case "file":
      return filePart(o, part, visitor);
    case "binary":
      return binaryPart(o, part, visitor);
    case "tool_use":
    case "tool_call":
      return visitor.toolCall({
        name: toolCallName(o),
        arguments: o.arguments ?? o.input ?? o.args,
      });
    case "tool_result":
      return visitor.toolResult({ result: o.content ?? o.result });
    case "image_url":
      return imageUrlPart(o, part, visitor);
    default:
      return unclaimedPart(o, part, visitor);
  }
}

export function dispatchContentPart<R>(
  part: unknown,
  visitor: ContentPartVisitor<R>,
): R | undefined;
export function dispatchContentPart<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined;
export function dispatchContentPart<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): R | Promise<R> | undefined {
  if (typeof part === "string") {
    return visitor.text(part);
  }

  const o = tryParseRecord(part);
  if (!o) {
    return visitor.unknown?.(part);
  }

  return dispatchRecordPart(o, part, visitor);
}

export function visitContentPart<R>(part: unknown, visitor: ContentPartVisitor<R>): R | undefined {
  return dispatchContentPart(part, visitor);
}

function imageUrlFromPart(o: Record<string, unknown>): string | null {
  if (o.type !== "image_url") return null;
  const carrier = o.image_url;
  if (typeof carrier === "string" && carrier) return carrier;
  const record = tryParseRecord(carrier);
  return record && typeof record.url === "string" ? record.url : null;
}

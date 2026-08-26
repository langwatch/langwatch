import {
  openAiFilePayloadToBinaryPart,
  mediaTypeToAudioFormat,
} from "./trace-content-part.file-decoder";
import { toMediaPart } from "./trace-content-part.provider-source";
import { tryParseRecord } from "./trace-content-part.record-schema";
import type {
  AsyncContentPartVisitor,
  ContentPartVisitor,
} from "./trace-content-part.types";

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

  if (o.type === "text" || (!o.type && o.text)) {
    const text =
      typeof o.text === "string"
        ? o.text
        : typeof o.content === "string"
          ? o.content
          : "";
    return visitor.text(text);
  }

  {
    const mediaPart = toMediaPart(o);
    if (mediaPart) return visitor.media(mediaPart);
  }

  if (o.type === "input_audio") {
    const ia = tryParseRecord(o.input_audio);
    if (!ia) return visitor.unknown?.(part);

    const data = typeof ia.data === "string" ? ia.data : undefined;
    const url = typeof ia.url === "string" ? ia.url : undefined;
    if (data || url) {
      return visitor.inputAudio
        ? visitor.inputAudio({
            data,
            url,
            format: typeof ia.format === "string" ? ia.format : undefined,
            mimeType: typeof ia.mimeType === "string" ? ia.mimeType : undefined,
          })
        : visitor.unknown?.(part);
    }
  }

  if (o.type === "file" && typeof o.mediaType === "string") {
    const mimeType = o.mediaType.toLowerCase();
    const data = typeof o.data === "string" ? o.data : undefined;
    const url = typeof o.url === "string" ? o.url : undefined;
    if (data || url) {
      if (mimeType.startsWith("audio/")) {
        return visitor.inputAudio
          ? visitor.inputAudio({
              data,
              url,
              format: mediaTypeToAudioFormat(mimeType),
              mimeType,
            })
          : visitor.unknown?.(part);
      }
      return visitor.binary({
        type: "binary",
        mimeType,
        data,
        url,
        id: typeof o.id === "string" ? o.id : undefined,
        filename: typeof o.filename === "string" ? o.filename : undefined,
      });
    }
  }

  if (o.type === "file") {
    const file = tryParseRecord(o.file);
    if (!file) return visitor.unknown?.(part);

    const binPart = openAiFilePayloadToBinaryPart(file);
    if (binPart?.mimeType.startsWith("audio/")) {
      return visitor.inputAudio
        ? visitor.inputAudio({
            data: binPart.data,
            format: mediaTypeToAudioFormat(binPart.mimeType),
            mimeType: binPart.mimeType,
          })
        : visitor.unknown?.(part);
    }
    if (binPart) {
      return visitor.binary(binPart);
    }
    return visitor.unknown?.(part);
  }

  if (o.type === "binary" && typeof o.mimeType === "string") {
    return visitor.binary({
      type: "binary",
      mimeType: o.mimeType,
      data: typeof o.data === "string" ? o.data : undefined,
      url: typeof o.url === "string" ? o.url : undefined,
      id: typeof o.id === "string" ? o.id : undefined,
      filename: typeof o.filename === "string" ? o.filename : undefined,
    });
  }

  if (o.type === "tool_use" || o.type === "tool_call") {
    return visitor.toolCall({
      name:
        typeof o.name === "string"
          ? o.name
          : typeof o.toolName === "string"
            ? o.toolName
            : "tool",
      arguments: o.arguments ?? o.input ?? o.args,
    });
  }

  if (o.type === "tool_result") {
    return visitor.toolResult({ result: o.content ?? o.result });
  }

  {
    const url = imageUrlFromPart(o);
    if (url !== null) {
      return visitor.imageUrl ? visitor.imageUrl(url) : visitor.unknown?.(part);
    }
  }

  if (typeof o.image === "string" && o.image) {
    const src = o.image;
    return visitor.bareImage ? visitor.bareImage(src) : visitor.unknown?.(part);
  }

  return visitor.unknown?.(part);
}

export function visitContentPart<R>(
  part: unknown,
  visitor: ContentPartVisitor<R>,
): R | undefined {
  return dispatchContentPart(part, visitor);
}

function imageUrlFromPart(o: Record<string, unknown>): string | null {
  if (o.type !== "image_url") return null;
  const carrier = o.image_url;
  if (typeof carrier === "string" && carrier) return carrier;
  const record = tryParseRecord(carrier);
  return record && typeof record.url === "string" ? record.url : null;
}

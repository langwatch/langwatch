import type { MediaPartData } from "../../model/transcript/types.ts";
import { isRecord } from "../../model/transcript/record.ts";

function source(
  value: unknown,
):
  | { type: "url"; value: string; mimeType?: string }
  | { type: "data"; value: string; mimeType: string }
  | null {
  if (!isRecord(value)) return null;

  const record = value;
  const valueString = typeof record.value === "string" ? record.value : null;
  const data = typeof record.data === "string" ? record.data : null;
  const url = typeof record.url === "string" ? record.url : (valueString ?? data);
  if (!url) return null;
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : undefined;
  if (record.type === "data" || data)
    return { type: "data", value: url, mimeType: mimeType ?? "application/octet-stream" };
  return { type: "url", value: url, ...(mimeType ? { mimeType } : {}) };
}

function mediaWithSource(
  type: "image" | "audio" | "video",
  mediaSource: NonNullable<ReturnType<typeof source>>,
): MediaPartData {
  return mediaSource.type === "url" ? { type, source: mediaSource } : { type, source: mediaSource };
}

function parseBinaryPart(record: Record<string, unknown>): MediaPartData | null {
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : null;
  if (!mimeType || (typeof record.url !== "string" && typeof record.data !== "string")) return null;
  return {
    type: "binary",
    mimeType,
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.url === "string" ? { url: record.url } : {}),
    ...(typeof record.data === "string" ? { data: record.data } : {}),
    ...(typeof record.filename === "string" ? { filename: record.filename } : {}),
  };
}

function parseImageUrlPart(record: Record<string, unknown>): MediaPartData | null {
  const imageUrl = record.image_url;
  const imageRecord = isRecord(imageUrl) ? imageUrl : null;
  const imageSource = source(imageRecord);
  return imageSource ? mediaWithSource("image", imageSource) : null;
}

function parseInputAudioPart(record: Record<string, unknown>): MediaPartData | null {
  const audioSource = source(record.input_audio);
  return audioSource ? mediaWithSource("audio", audioSource) : null;
}

function parseFilePart(record: Record<string, unknown>): MediaPartData | null {
  const mimeType = typeof record.mediaType === "string" ? record.mediaType : null;
  const data = typeof record.data === "string" ? record.data : null;
  const url = typeof record.url === "string" ? record.url : null;
  if (!mimeType || (!data && !url)) return null;

  const sourceValue = data ?? url;
  if (!sourceValue) return null;

  const dataOrUrlSource = data
    ? ({ type: "data", value: data, mimeType } as const)
    : ({ type: "url", value: sourceValue, mimeType } as const);

  if (mimeType.startsWith("audio/")) {
    return mediaWithSource("audio", dataOrUrlSource);
  }
  const isImage = mimeType.startsWith("image/");
  const isVisual = isImage || mimeType.startsWith("video/");
  if (isVisual) {
    return mediaWithSource(isImage ? "image" : "video", dataOrUrlSource);
  }
  return { type: "binary", mimeType, ...(data ? { data } : { url: sourceValue }) };
}

const TYPED_MEDIA_KINDS = new Set(["audio", "image", "video", "document"]);

function parseTypedMediaPart(
  type: "audio" | "image" | "video" | "document",
  record: Record<string, unknown>,
): MediaPartData | null {
  const mediaSource = source(record.source);
  if (!mediaSource) return null;
  if (type === "document") {
    return {
      type: "binary",
      mimeType: mediaSource.mimeType ?? "application/octet-stream",
      ...(mediaSource.type === "url" ? { url: mediaSource.value } : { data: mediaSource.value }),
    };
  }
  return mediaWithSource(type, mediaSource);
}

/** Maps the trace wire's common media parts to the renderer-neutral shape. */
export function mediaPartToMediaData(part: unknown): MediaPartData | null {
  if (!isRecord(part)) return null;

  const record = part;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "binary") return parseBinaryPart(record);
  if (type === "image_url") return parseImageUrlPart(record);
  if (type === "input_audio") return parseInputAudioPart(record);
  if (type === "file") return parseFilePart(record);
  if (TYPED_MEDIA_KINDS.has(type)) {
    return parseTypedMediaPart(type as "audio" | "image" | "video" | "document", record);
  }
  return null;
}

import type { MediaPartData } from "./types";
import { isRecord } from "./record";

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
  return mediaSource.type === "url"
    ? { type, source: mediaSource }
    : { type, source: mediaSource };
}

/** Maps the trace wire's common media parts to the renderer-neutral shape. */
export function mediaPartToMediaData(part: unknown): MediaPartData | null {
  if (!isRecord(part)) return null;

  const record = part;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "binary") {
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : null;
    if (!mimeType || (typeof record.url !== "string" && typeof record.data !== "string"))
      return null;
    return {
      type: "binary",
      mimeType,
      ...(typeof record.id === "string" ? { id: record.id } : {}),
      ...(typeof record.url === "string" ? { url: record.url } : {}),
      ...(typeof record.data === "string" ? { data: record.data } : {}),
      ...(typeof record.filename === "string" ? { filename: record.filename } : {}),
    };
  }
  if (type === "image_url") {
    const imageUrl = record.image_url;
    const imageRecord = isRecord(imageUrl) ? imageUrl : null;
    const imageSource = source(imageRecord);
    return imageSource ? mediaWithSource("image", imageSource) : null;
  }
  if (type === "input_audio") {
    const audioSource = source(record.input_audio);
    return audioSource ? mediaWithSource("audio", audioSource) : null;
  }
  if (type === "file") {
    const mimeType = typeof record.mediaType === "string" ? record.mediaType : null;
    const data = typeof record.data === "string" ? record.data : null;
    const url = typeof record.url === "string" ? record.url : null;
    if (!mimeType || (!data && !url)) return null;

    const sourceValue = data ?? url;
    if (!sourceValue) return null;

    if (mimeType.startsWith("audio/")) {
      return mediaWithSource(
        "audio",
        data
          ? { type: "data", value: data, mimeType }
          : { type: "url", value: sourceValue, mimeType },
      );
    }
    if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) {
      const mediaType = mimeType.startsWith("image/") ? "image" : "video";
      return mediaWithSource(
        mediaType,
        data
          ? { type: "data", value: data, mimeType }
          : { type: "url", value: sourceValue, mimeType },
      );
    }
    return { type: "binary", mimeType, ...(data ? { data } : { url: sourceValue }) };
  }
  if (type === "audio" || type === "image" || type === "video" || type === "document") {
    const mediaSource = source(record.source);
    if (!mediaSource) return null;
    if (type === "document") {
      return {
        type: "binary",
        mimeType: mediaSource.mimeType ?? "application/octet-stream",
        ...(mediaSource.type === "url"
          ? { url: mediaSource.value }
          : { data: mediaSource.value }),
      };
    }
    return mediaWithSource(type, mediaSource);
  }
  return null;
}

import type { ContentSource } from "./trace-content-part.types";
import { tryParseRecord } from "./trace-content-part.record-schema";

interface NormalizedMediaPart {
  type: "image" | "audio" | "video" | "document";
  source: ContentSource;
}

export function normalizeContentSource(source: unknown): ContentSource | null {
  const s = tryParseRecord(source);
  if (!s) return null;

  const mimeType = firstString(s, "mimeType", "media_type")?.toLowerCase();

  if (s.type === "url") {
    return typedSource("url", firstString(s, "value", "url"), mimeType);
  }
  if (s.type === "data" || s.type === "base64") {
    return typedSource("data", firstString(s, "value", "data"), mimeType);
  }
  return null;
}

function typedSource(
  type: "url" | "data",
  value: string | undefined,
  mimeType: string | undefined,
): ContentSource | null {
  if (value === undefined) return null;
  return mimeType ? { type, value, mimeType } : { type, value };
}

function firstString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = o[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function mediaKindForMimeType(mimeType: string): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export function inlineDataToMediaPart(o: Record<string, unknown>): NormalizedMediaPart | null {
  const carrier = o.inline_data ?? o.inlineData;
  const c = tryParseRecord(carrier);
  if (!c) return null;

  const data = typeof c.data === "string" ? c.data : undefined;
  const rawMimeType =
    typeof c.mime_type === "string"
      ? c.mime_type
      : typeof c.mimeType === "string"
        ? c.mimeType
        : undefined;
  if (data === undefined || rawMimeType === undefined) return null;
  const mimeType = rawMimeType.toLowerCase();
  return {
    type: mediaKindForMimeType(mimeType),
    source: { type: "data", value: data, mimeType },
  };
}

function toMediaPart(o: Record<string, unknown>): NormalizedMediaPart | null {
  if (
    (o.type === "image" || o.type === "audio" || o.type === "video" || o.type === "document") &&
    o.source
  ) {
    const source = normalizeContentSource(o.source);
    return source ? { type: o.type, source } : null;
  }
  return inlineDataToMediaPart(o);
}

export function isInlineDataCarrier(part: unknown): boolean {
  const o = tryParseRecord(part);
  if (!o) return false;

  return o.inline_data !== undefined || o.inlineData !== undefined;
}

export { toMediaPart };

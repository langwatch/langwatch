import { parseRecord } from "./trace-content-part.record-schema.ts";
import type { ContentSource } from "./trace-content-part.types.ts";

interface NormalizedMediaPart {
  type: "image" | "audio" | "video" | "document";
  source: ContentSource;
}

export function normalizeContentSource(source: unknown): ContentSource | null {
  const s = parseRecord(source);
  if (!s) return null;

  const mimeType = findFirstString(s, "mimeType", "media_type")?.toLowerCase();

  if (s.type === "url") {
    return extractTypedSource("url", findFirstString(s, "value", "url"), mimeType);
  }
  if (s.type === "data" || s.type === "base64") {
    return extractTypedSource("data", findFirstString(s, "value", "data"), mimeType);
  }
  return null;
}

function extractTypedSource(
  type: "url" | "data",
  value: string | undefined,
  mimeType: string | undefined,
): ContentSource | null {
  if (value === undefined) return null;
  return mimeType ? { type, value, mimeType } : { type, value };
}

function findFirstString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
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

export function convertInlineDataToMediaPart(
  o: Record<string, unknown>,
): NormalizedMediaPart | null {
  const carrier = o.inline_data ?? o.inlineData;
  const c = parseRecord(carrier);
  if (!c) return null;

  const data = typeof c.data === "string" ? c.data : undefined;
  const camelMimeType = typeof c.mimeType === "string" ? c.mimeType : undefined;
  const rawMimeType = typeof c.mime_type === "string" ? c.mime_type : camelMimeType;
  if (data === undefined || rawMimeType === undefined) return null;
  const mimeType = rawMimeType.toLowerCase();
  return {
    type: mediaKindForMimeType(mimeType),
    source: { type: "data", value: data, mimeType },
  };
}

function toMediaPart(o: Record<string, unknown>): NormalizedMediaPart | null {
  const type = o.type;
  const isMediaType =
    type === "image" || type === "audio" || type === "video" || type === "document";
  if (isMediaType && o.source) {
    const source = normalizeContentSource(o.source);
    return source ? { type, source } : null;
  }
  return convertInlineDataToMediaPart(o);
}

export function isInlineDataCarrier(part: unknown): boolean {
  const o = parseRecord(part);
  if (!o) return false;

  return o.inline_data !== undefined || o.inlineData !== undefined;
}

export { toMediaPart };

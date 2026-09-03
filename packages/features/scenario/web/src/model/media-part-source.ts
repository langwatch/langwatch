import { isSafeMediaUrl, type MediaPartData, parseNotCapturedMedia } from "./media-parts";

export type MediaCategory = "audio" | "image" | "video" | "binary";

export interface ResolvedMediaPart {
  category: MediaCategory;
  isUrlBased: boolean;
  mimeType?: string;
  notCaptured: ReturnType<typeof parseNotCapturedMedia>;
  src: string;
  storedObjectId: string | null;
  unsafeSrc: boolean;
}

export function resolveMediaPart(part: MediaPartData): ResolvedMediaPart {
  const mimeType = part.type === "binary" ? part.mimeType : part.source.mimeType;
  const category = resolveMediaCategory(part.type, mimeType);
  const src = resolveSource(part, mimeType);
  const isUrlBased =
    src !== "" &&
    !src.startsWith("data:") &&
    (part.type === "binary" ? Boolean(part.url) : part.source.type === "url");
  const unsafeSrc = src !== "" && !isSafeMediaUrl(src);
  const notCaptured = unsafeSrc ? parseNotCapturedMedia(src) : null;
  const storedObjectId = isUrlBased ? extractStoredObjectId(src) : null;

  return {
    category,
    isUrlBased,
    mimeType,
    notCaptured,
    src,
    storedObjectId,
    unsafeSrc,
  };
}

function resolveSource(part: MediaPartData, mimeType?: string): string {
  if (part.type !== "binary") {
    return part.source.type === "url"
      ? part.source.value
      : `data:${mimeType};base64,${part.source.value}`;
  }

  if (part.url) {
    return part.url;
  }

  return part.data ? `data:${mimeType};base64,${part.data}` : "";
}

function resolveMediaCategory(type: string, mimeType?: string): MediaCategory {
  if (type === "image" || type === "audio" || type === "video") {
    return type;
  }

  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType?.startsWith("image/")) {
    return "image";
  }

  return mimeType?.startsWith("video/") ? "video" : "binary";
}

function extractStoredObjectId(url: string): string | null {
  const match = /^\/api\/files\/(?:[^/?#]+\/)?([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

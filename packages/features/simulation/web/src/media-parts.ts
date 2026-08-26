export type MediaPartData =
  | {
      type: "image" | "audio" | "video";
      source: { type: "url"; value: string; mimeType?: string };
    }
  | {
      type: "image" | "audio" | "video";
      source: { type: "data"; value: string; mimeType: string };
    }
  | {
      type: "binary";
      mimeType: string;
      id?: string;
      url?: string;
      data?: string;
      filename?: string;
    };

export function isSafeMediaUrl(url: string): boolean {
  const cleaned = [...url].filter((character) => character.charCodeAt(0) > 32).join("");
  if (cleaned.startsWith("/api/files/")) return !cleaned.includes("..");
  const lower = cleaned.toLowerCase();
  return (
    lower.startsWith("data:") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://")
  );
}

export interface NotCapturedMedia {
  mediaType: string;
  sizeBytes: number;
}

const NOT_CAPTURED_SUMMARY = /^([^,\]]+),\s*(\d+)\s*bytes\]$/;

export function parseNotCapturedMedia(value: string): NotCapturedMedia | null {
  const match = NOT_CAPTURED_SUMMARY.exec(value.trim().replace(/^\[/, ""));
  if (!match?.[1] || !match[2]) return null;
  return { mediaType: match[1], sizeBytes: Number(match[2]) };
}

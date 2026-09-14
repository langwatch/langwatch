/**
 * FROZEN TWIN: platform/app/src/shared/content-parts/media-markers.ts. Cheap gate
 * for detecting inline media. Bare substrings handle JSON-inside-JSON escaping.
 */
const MEDIA_MARKERS = [
  ";base64,",
  "input_audio",
  "file_data",
  "mediaType",
  "mimeType",
  "media_type",
  "mime_type",
] as const;

export function containsMediaMarkers(value: string): boolean {
  return MEDIA_MARKERS.some((marker) => value.includes(marker));
}

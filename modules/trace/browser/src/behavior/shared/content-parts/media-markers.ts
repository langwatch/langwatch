/**
 * media-markers — the cheap gate deciding whether a string value can carry an inline
 * media content part at all.
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

/**
 * media-markers — the cheap gate deciding whether a string value can carry an
 * inline media content part at all. Pure and dependency-free: imported by the
 * server-side value walker AND by the client-side media collectors (which run
 * isomorphically in the traces-v2 transcript parse path), so nothing heavier
 * than a substring scan may live here.
 *
 * Deliberately bare substrings, never quoted tokens: span attribute values
 * routinely carry messages as JSON-inside-JSON (the typed-raw envelope), so
 * quotes appear escaped (`\"` once nested, `\\\"` twice). A quote-anchored
 * pattern misses those; a bare substring survives any escape depth.
 *
 *  - `;base64,`     → any RFC 2397 data URI (image_url, bare image, file_data)
 *  - `input_audio`  → OpenAI Realtime audio parts
 *  - `file_data`    → OpenAI ChatCompletion file payloads
 *  - `mediaType`    → AI-SDK file/image parts
 *  - `mimeType`     → AG-UI binary parts and media source shapes
 *
 * A rare false positive (e.g. ordinary JSON that mentions `mediaType`) costs
 * one JSON.parse and a walk that finds no parts — cheap and harmless.
 */
const MEDIA_MARKERS = [
  ";base64,",
  "input_audio",
  "file_data",
  "mediaType",
  "mimeType",
] as const;

export function containsMediaMarkers(value: string): boolean {
  return MEDIA_MARKERS.some((marker) => value.includes(marker));
}

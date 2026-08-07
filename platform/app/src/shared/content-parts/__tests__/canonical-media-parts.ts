/**
 * Canonical media content-part examples — one per shape branch of
 * `visitContentPart` that carries inline bytes the extractor externalizes.
 *
 * Consumed by the parity test to pin three couplings at once:
 *  - the ingestion-side classifier/extractor and the render-side collector
 *    reach the same shapes (divergence = stored bytes nothing renders);
 *  - every extractable shape's serialized form trips `containsMediaMarkers`
 *    (a shape added to the visitor without a matching marker silently
 *    regresses extraction to passthrough);
 *  - url-only variants of each shape stay untouched by both sides.
 *
 * Adding a shape to `visit-content-part.ts`? Add its example here and the
 * parity test enforces the rest.
 */

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAE=";
const AUDIO_B64 = "AAAAEAAg";

export interface CanonicalPartExample {
  name: string;
  part: Record<string, unknown>;
}

/** Parts carrying inline bytes — the extractor must externalize every one. */
export const EXTRACTABLE_PART_EXAMPLES: CanonicalPartExample[] = [
  {
    name: "AI-SDK audio file part",
    part: { type: "file", mediaType: "audio/pcm16", data: AUDIO_B64 },
  },
  {
    name: "AI-SDK non-audio file part",
    part: { type: "file", mediaType: "application/pdf", data: PNG_B64 },
  },
  {
    name: "OpenAI file part with data-URI file_data",
    part: {
      type: "file",
      file: {
        filename: "report.pdf",
        file_data: `data:application/pdf;base64,${PNG_B64}`,
      },
    },
  },
  {
    name: "OpenAI Realtime input_audio part",
    part: {
      type: "input_audio",
      input_audio: { data: AUDIO_B64, format: "wav" },
    },
  },
  {
    name: "image_url part with data URI",
    part: {
      type: "image_url",
      image_url: { url: `data:image/png;base64,${PNG_B64}` },
    },
  },
  {
    name: "string-form image_url part with data URI",
    part: {
      type: "image_url",
      image_url: `data:image/png;base64,${PNG_B64}`,
    },
  },
  {
    name: "bare image property with data URI",
    part: { image: `data:image/png;base64,${PNG_B64}` },
  },
  {
    name: "binary part with inline data",
    part: { type: "binary", mimeType: "application/pdf", data: PNG_B64 },
  },
  {
    name: "AG-UI media part with data source",
    part: {
      type: "audio",
      source: { type: "data", value: AUDIO_B64, mimeType: "audio/wav" },
    },
  },
];

/**
 * Parts with no inline bytes — already externalized or externally hosted.
 * The extractor must pass every one through untouched.
 */
export const NON_EXTRACTABLE_PART_EXAMPLES: CanonicalPartExample[] = [
  {
    name: "externalized input_audio reference",
    part: {
      type: "input_audio",
      input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
    },
  },
  {
    name: "externalized binary reference",
    part: {
      type: "binary",
      mimeType: "application/pdf",
      url: "/api/files/p1/f1",
      filename: "report.pdf",
    },
  },
  {
    name: "external http image_url",
    part: {
      type: "image_url",
      image_url: { url: "https://cdn.example/i.png" },
    },
  },
  {
    name: "string-form external http image_url",
    part: { type: "image_url", image_url: "https://cdn.example/i.png" },
  },
  {
    name: "text part",
    part: { type: "text", text: "hello there" },
  },
];

export type NewlineTreatment = "glyph" | "space" | "preserve";

export interface PreviewOptions {
  /** Hard cap on output length (post-pipeline). */
  maxChars: number;
  /** Controls whether source newlines are shown, collapsed, or preserved. */
  newlines?: NewlineTreatment;
  /** Strips fenced-code and markdown-image syntax when enabled. */
  stripMarkdownNoise?: boolean;
}

export interface PreviewResult {
  /** The formatted, truncated string ready for direct rendering. */
  text: string;
  /** The most recent chat message's recognised role, when available. */
  role?: "user" | "assistant" | "system" | "tool";
  /** A fenced code block was discarded during noise-strip. */
  hadCode?: boolean;
  /** A markdown image was discarded during noise-strip. */
  hadImage?: boolean;
}

export type SpanScope = "none" | "ai" | "all";
export type SpanDetailLevel = "names" | "core" | "full";
export type SpanLayout = "bullets" | "tree";

export interface MarkdownConfig {
  spanScope: SpanScope;
  spanDetail: SpanDetailLevel;
  spanLayout: SpanLayout;
  includeIO: boolean;
  includeMetadata: boolean;
  includeSpanIO: boolean;
  includeSpanAttributes: boolean;
  /** Include a Unicode waterfall chart (Gantt-style block-character bars). */
  includeWaterfall: boolean;
  /** Include a Unicode flame graph (one row per stack depth). */
  includeFlame: boolean;
}

export const DEFAULT_MARKDOWN_CONFIG: MarkdownConfig = {
  spanScope: "ai",
  spanDetail: "core",
  spanLayout: "tree",
  includeIO: true,
  includeMetadata: false,
  includeSpanIO: false,
  includeSpanAttributes: false,
  includeWaterfall: false,
  includeFlame: false,
};

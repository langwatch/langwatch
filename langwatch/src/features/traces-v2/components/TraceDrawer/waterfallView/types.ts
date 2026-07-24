import type { IconType } from "react-icons";
import {
  LuBot,
  LuBrain,
  LuCircle,
  LuClipboardCheck,
  LuDatabase,
  LuLink2,
  LuPackage,
  LuShield,
  LuWorkflow,
  LuWrench,
} from "react-icons/lu";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { SPAN_TYPE_COLORS } from "../../../utils/formatters";
import { isSkillSpan } from "../transcript/skillInvocation";

export interface WaterfallViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  /** Span ids that carry a managed prompt — rendered with a book icon so
   *  the operator can spot prompt-bearing spans in the tree at a glance. */
  promptSpanIds?: ReadonlySet<string>;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
}

export interface WaterfallTreeNode {
  span: SpanTreeNode;
  children: WaterfallTreeNode[];
  depth: number;
  isOrphaned: boolean;
}

export interface SiblingGroup {
  kind: "group";
  name: string;
  /** Tool display name when the whole group is one tool (key includes it). */
  toolName: string | null;
  type: string;
  count: number;
  spans: SpanTreeNode[];
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  errorCount: number;
  minStart: number;
  maxEnd: number;
  depth: number;
  parentSpanId: string | null;
}

export type FlatRow = { kind: "span"; node: WaterfallTreeNode } | SiblingGroup;

export const ROW_HEIGHT = 28;
export const LLM_ROW_HEIGHT = 40;
export const GROUP_ROW_HEIGHT = 36;

/**
 * LLM spans (second line: model) and named tool spans (second line: tool)
 * render as two-line rows at `LLM_ROW_HEIGHT`. The virtualizer's height
 * estimator and `TreeRow`'s rendering must agree on this predicate or
 * rows overlap.
 */
export function isTwoLineSpan(
  span: Pick<SpanTreeNode, "type" | "model" | "toolName">,
): boolean {
  return (span.type === "llm" && span.model != null) || span.toolName != null;
}

export const INDENT_PX = 20;
export const MIN_TREE_WIDTH = 200;
export const DEFAULT_TREE_PCT = 0.38;
/**
 * Below this drawer width, the timeline/flame-graph panel is dropped
 * entirely and the span list takes the full width — the list is normally
 * more useful, and a narrow timeline pane (bars a few px wide, a divider,
 * truncated labels) is not.
 */
export const COLLAPSE_TIMELINE_BELOW_PX = 638;
export const MIN_BAR_PX = 3;
export const BAR_HEIGHT = 14;
export const SIBLING_GROUP_THRESHOLD = 5;

// SVG icons via react-icons/lu — the previous unicode glyphs (◈, ◎, ⊛, …) all
// rendered as near-identical small circles at xs text size, were anti-aligned
// against the row baseline, and gave no semantic hint about what the span
// actually was. Lucide glyphs are picked per concept and align cleanly.
export const SPAN_TYPE_ICONS: Record<string, IconType> = {
  llm: LuBrain,
  tool: LuWrench,
  agent: LuBot,
  rag: LuDatabase,
  guardrail: LuShield,
  evaluation: LuClipboardCheck,
  chain: LuLink2,
  workflow: LuWorkflow,
  module: LuPackage,
  span: LuCircle,
};

// Color palette base derived from `SPAN_TYPE_COLORS` (e.g. `"blue.solid"` →
// `"blue"`). Used to build chip backgrounds (`${palette}.subtle`) and
// foreground (`${palette}.fg`) in a way that respects light/dark mode tokens.
export function getSpanPalette(type: string | null | undefined): string {
  const palette: Record<string, string> = {
    llm: "blue",
    tool: "green",
    agent: "purple",
    rag: "teal",
    guardrail: "orange",
    evaluation: "pink",
    chain: "cyan",
    workflow: "teal",
    span: "gray",
    module: "gray",
  };
  return palette[type ?? "span"] ?? "gray";
}

/**
 * Resolved Chakra color token (e.g. `"purple.solid"`) for a span/group bar —
 * the timeline pane's counterpart to `getSpanPalette`. Skill runs get the
 * same purple accent as their tree-row twin (`isSkillSpan`), so the two
 * halves of a waterfall row never disagree; everything else falls back to
 * `SPAN_TYPE_COLORS`.
 */
export function getSpanBarColor(
  type: string | null | undefined,
  name: string | null | undefined,
): string {
  if (isSkillSpan({ type, name })) return "purple.solid";
  return (SPAN_TYPE_COLORS[type ?? "span"] as string) ?? "gray.solid";
}

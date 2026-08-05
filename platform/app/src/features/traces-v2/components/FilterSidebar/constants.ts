import type { Tokens } from "@chakra-ui/react";
import {
  Activity,
  AlertCircle,
  BookMarked,
  Bookmark,
  Boxes,
  Braces,
  Brain,
  Calculator,
  CheckSquare,
  Clock,
  Compass,
  Database,
  DollarSign,
  FileText,
  Gauge,
  HardDrive,
  Hash,
  History,
  type LucideIcon,
  MessageSquare,
  Server,
  Shield,
  Sparkles,
  Tag,
  Target,
  Timer,
  TimerReset,
  User,
  UserSquare,
  Users,
  Workflow,
} from "lucide-react";
import { FIELD_VALUES } from "~/server/app-layer/traces/query-language/metadata";
import { STATUS_COLORS } from "../../utils/formatters";
import { ORIGIN_DISPLAY } from "../../utils/originDisplay";

/** Section key for the trace-level Attributes block (reads `Attributes` map on `trace_summaries`). */
export const ATTRIBUTES_SECTION_KEY = "__attributes__";

/**
 * Section key for the Metadata block — the `metadata.*` subset of the trace
 * `Attributes` map, surfaced with the `metadata.` prefix stripped for display.
 * Syntactic sugar over the trace-attribute filter (see `metadata-keys.ts`).
 */
export const METADATA_SECTION_KEY = "__metadata__";

/**
 * Docs anchor for the Metadata facet's empty state (how to attach metadata via
 * the SDK). The facet stays visible with zero keys so users can find it and
 * learn how to populate it, instead of it silently not rendering.
 */
export const METADATA_DOCS_URL =
  "https://docs.langwatch.ai/integration/python/guide#adding-metadata";

/** Section key for the span-level Attributes block (reads `SpanAttributes` map on `stored_spans`). */
export const SPAN_ATTRIBUTES_SECTION_KEY = "__span_attributes__";

/** Section key for the per-event Attributes block (reads `Events.Attributes` on `stored_spans`). */
export const EVENT_ATTRIBUTES_SECTION_KEY = "__event_attributes__";

/** Acronyms whose canonical casing differs from the raw value. */
export const FACET_LABELS: Record<string, string> = {
  ok: "OK",
  llm: "LLM",
  rag: "RAG",
};

/** Fields whose values are short, closed enums and look better title-cased. */
export const NORMAL_CASE_FIELDS = new Set([
  "status",
  "origin",
  "spanType",
  "spanStatus",
  "rootSpanType",
  "guardrail",
  "annotation",
  "containsAi",
  "tokensEstimated",
  "evaluatorStatus",
  "evaluatorVerdict",
]);

/**
 * Status keeps a fixed traffic-light mapping. Origin derives its dot
 * colours from the shared `ORIGIN_DISPLAY` table — the same one the
 * Origin column badge consumes — so "evaluation" is always green,
 * "application" always blue, in both the sidebar and the table.
 * Span Type still hashes — the value set is open-ended.
 */
export const FACET_COLORS: Record<string, Record<string, Tokens["colors"]>> = {
  status: STATUS_COLORS,
  origin: Object.fromEntries(
    Object.entries(ORIGIN_DISPLAY).map(([value, { colorPalette }]) => [
      value,
      `${colorPalette}.solid`,
    ]),
  ),
};

export const SPAN_TYPE_DEFAULTS = [
  "llm",
  "tool",
  "agent",
  "rag",
  "guardrail",
  "evaluation",
  "workflow",
  "chain",
  "module",
  "span",
];

export const FACET_DEFAULTS: Record<string, string[]> = {
  origin: FIELD_VALUES.origin ?? [],
  status: FIELD_VALUES.status ?? [],
  spanType: SPAN_TYPE_DEFAULTS,
  rootSpanType: SPAN_TYPE_DEFAULTS,
  spanStatus: ["ok", "error", "unset"],
  guardrail: ["blocked", "allowed"],
  annotation: ["annotated", "unannotated"],
  containsAi: ["yes", "no"],
  tokensEstimated: ["estimated", "actual"],
  // Open-ended categoricals: seed with empty values so the sidebar renders
  // the section immediately. Values populate once discover responds.
  model: [],
  service: [],
  user: [],
  conversation: [],
  errorMessage: [],
  evaluator: [],
};

/**
 * Range keys that should appear in the sidebar immediately — even before
 * discover responds — as synthetic placeholder sections. Rendered with
 * a disabled state (min === max === 0, flagged synthetic) so users can
 * see the affordance without being able to interact with a zero-span range.
 */
export const RANGE_DEFAULTS: readonly string[] = ["duration", "cost", "tokens"];

/**
 * Fields whose colour palette is curated. Other categoricals get hashed
 * colours rendered at reduced opacity to keep the sidebar visually calm.
 */
export const VIBRANT_FIELDS = new Set(["status", "origin", "spanType"]);

export const FACET_ICONS: Record<string, LucideIcon> = {
  origin: Compass,
  status: Activity,
  spanType: Boxes,
  rootSpanType: Workflow,
  traceName: FileText,
  guardrail: Shield,
  annotation: Bookmark,
  containsAi: Brain,
  errorMessage: AlertCircle,
  tokensEstimated: Calculator,
  model: Sparkles,
  service: Server,
  user: User,
  conversation: MessageSquare,
  customer: UserSquare,
  scenarioRun: Target,
  topic: Tag,
  subtopic: Tag,
  label: Tag,
  evaluator: CheckSquare,
  evaluatorStatus: Activity,
  evaluatorVerdict: CheckSquare,
  evaluatorScore: Hash,
  evaluatorLabel: Tag,
  event: Activity,
  cost: DollarSign,
  duration: Clock,
  ttft: Timer,
  ttlt: TimerReset,
  tokens: Hash,
  promptTokens: Hash,
  completionTokens: Hash,
  tokensPerSecond: Gauge,
  size: HardDrive,
  selectedPrompt: BookMarked,
  lastUsedPrompt: History,
  promptVersion: Hash,
  spanName: FileText,
  spanStatus: Activity,
  [METADATA_SECTION_KEY]: Braces,
  [ATTRIBUTES_SECTION_KEY]: Database,
  [SPAN_ATTRIBUTES_SECTION_KEY]: Database,
  [EVENT_ATTRIBUTES_SECTION_KEY]: Database,
};

/**
 * Icons for the popover's group headers. The sidebar itself no longer
 * renders group headings (the section list is flat); these icons are
 * for the FacetManagerPopover which still groups facets by AI-
 * observability axis.
 */
export const GROUP_ICONS: Record<string, LucideIcon> = {
  traces: Compass,
  errors: AlertCircle,
  spans: Boxes,
  subjects: Users,
  model: Sparkles,
  prompts: BookMarked,
  quality: CheckSquare,
  topics: Tag,
  cost: DollarSign,
  latency: Clock,
  volume: Hash,
  custom: Database,
};

export interface FacetGroupDef {
  id:
    | "traces"
    | "errors"
    | "spans"
    | "subjects"
    | "model"
    | "prompts"
    | "quality"
    | "topics"
    | "cost"
    | "latency"
    | "volume"
    | "custom";
  label: string;
  keys: string[];
}

/**
 * Finer-grained facet sub-groups, surfaced through three task-oriented
 * "perspectives" (see {@link FACET_PERSPECTIVES}). Every facet belongs to
 * exactly one sub-group; a perspective only reorders the sub-groups so the
 * ones relevant to that task lead. The array order here is the default
 * (Observability) perspective.
 *
 * The sidebar itself stays a flat, drag-reorderable column — these headings
 * are the FacetManagerPopover's "browse what's available" structure and the
 * unit by which a perspective reorders the sidebar.
 */
export const FACET_GROUPS: FacetGroupDef[] = [
  // "What kind of trace is this?" — origin / shape / human-readable name,
  // plus the user-defined `metadata.*` and trace-attribute maps that live on
  // the trace. The dynamic trace-attribute section sits here (not in a
  // catch-all "Custom" group) so attribute filters live beside the trace
  // fields they belong to.
  {
    id: "traces",
    label: "Traces",
    keys: [
      "origin",
      "rootSpanType",
      "traceName",
      METADATA_SECTION_KEY,
      ATTRIBUTES_SECTION_KEY,
    ],
  },
  // "What's broken?" — error + intervention signals.
  {
    id: "errors",
    label: "Errors",
    keys: ["status", "errorMessage", "guardrail", "containsAi"],
  },
  // "What happened during the trace?" — per-span / per-event slices, plus
  // the dynamic span- and event-attribute maps (kept here beside the span /
  // event fields rather than in a catch-all "Custom" group).
  {
    id: "spans",
    label: "Spans & Events",
    keys: [
      "spanType",
      "spanName",
      "spanStatus",
      "event",
      SPAN_ATTRIBUTES_SECTION_KEY,
      EVENT_ATTRIBUTES_SECTION_KEY,
    ],
  },
  // "Who is using it?" — person / session / tenant / simulator run.
  {
    id: "subjects",
    label: "Subjects",
    keys: ["user", "conversation", "customer", "scenarioRun"],
  },
  // "How slow is it?" — latency + throughput.
  {
    id: "latency",
    label: "Latency",
    keys: ["duration", "ttft", "ttlt", "tokensPerSecond"],
  },
  // "How big is it?" — span count and stored payload size.
  {
    id: "volume",
    label: "Volume",
    keys: ["spans", "size"],
  },
  // "How much does it cost?" — spend + the token counts that drive it.
  {
    id: "cost",
    label: "Cost",
    keys: [
      "cost",
      "tokens",
      "promptTokens",
      "completionTokens",
      "tokensEstimated",
    ],
  },
  // "Which model is this?" — the routing axis.
  {
    id: "model",
    label: "Model",
    keys: ["model", "service"],
  },
  // "Is the AI any good?" — evals + human feedback.
  {
    id: "quality",
    label: "Quality",
    keys: [
      "evaluator",
      "evaluatorStatus",
      "evaluatorVerdict",
      "evaluatorScore",
      "evaluatorLabel",
      "annotation",
    ],
  },
  // "What is this trace about?" — the semantic-clustering axis.
  {
    id: "topics",
    label: "Topics",
    keys: ["topic", "subtopic", "label"],
  },
  // "Which prompt produced it?" — prompt configuration.
  {
    id: "prompts",
    label: "Prompts",
    keys: ["selectedPrompt", "lastUsedPrompt", "promptVersion"],
  },
  // Fallback bucket for any section key not mapped to a group above (the
  // `?? "custom"` callers in useFilterSidebarData / FacetManagerPopover land
  // here). The known attribute maps now live in Traces / Spans & Events, so
  // this is empty by default — it only catches genuinely-unmapped keys.
  {
    id: "custom",
    label: "Custom",
    keys: [],
  },
];

export const SECTION_ORDER: string[] = FACET_GROUPS.flatMap((g) => g.keys);

const KEY_TO_GROUP_ID: Record<string, FacetGroupDef["id"]> = (() => {
  const map: Record<string, FacetGroupDef["id"]> = {};
  for (const group of FACET_GROUPS) {
    for (const key of group.keys) map[key] = group.id;
  }
  return map;
})();

/** Group id this section key belongs to, or `undefined` if unknown. */
export function getFacetGroupId(key: string): FacetGroupDef["id"] | undefined {
  return KEY_TO_GROUP_ID[key];
}

/**
 * Facet perspectives — three task-oriented views over the *same* full facet
 * set. A perspective never hides a facet; it only reorders the sub-groups
 * (and therefore the sidebar) so the ones relevant to that task lead. The
 * facet manager exposes a switcher; selecting one stamps the perspective's
 * order into the facet lens (see `facetLensStore.selectPerspective`).
 *
 * Named "perspectives", deliberately NOT "lenses" — the toolbar already owns
 * "lens" for trace-list sort/filter presets (a separate control).
 */
export type FacetPerspectiveId = "observability" | "llm" | "cost-performance";

export interface FacetPerspectiveDef {
  id: FacetPerspectiveId;
  label: string;
  /**
   * Sub-group ids in the order this perspective surfaces them. Need not be
   * exhaustive — any omitted group is appended in registry order so a facet
   * is never dropped (see {@link groupOrderForPerspective}).
   */
  groupOrder: FacetGroupDef["id"][];
}

/** The perspective a brand-new user starts in. */
export const DEFAULT_PERSPECTIVE_ID: FacetPerspectiveId = "observability";

export const FACET_PERSPECTIVES: FacetPerspectiveDef[] = [
  {
    id: "observability",
    label: "Observability",
    // Matches the FACET_GROUPS array order, so an un-stamped lens (the
    // default) already reads as the Observability perspective.
    groupOrder: [
      "traces",
      "errors",
      "spans",
      "subjects",
      "latency",
      "volume",
      "cost",
      "model",
      "quality",
      "topics",
      "prompts",
      "custom",
    ],
  },
  {
    id: "llm",
    label: "LLM",
    groupOrder: [
      "model",
      "prompts",
      "quality",
      "topics",
      "subjects",
      "cost",
      "volume",
      "traces",
      "spans",
      "errors",
      "latency",
      "custom",
    ],
  },
  {
    id: "cost-performance",
    label: "Cost & Performance",
    groupOrder: [
      "cost",
      "latency",
      "volume",
      "model",
      "traces",
      "errors",
      "quality",
      "spans",
      "subjects",
      "topics",
      "prompts",
      "custom",
    ],
  },
];

const PERSPECTIVE_BY_ID = new Map(FACET_PERSPECTIVES.map((p) => [p.id, p]));

export function isFacetPerspectiveId(x: unknown): x is FacetPerspectiveId {
  return (
    typeof x === "string" && PERSPECTIVE_BY_ID.has(x as FacetPerspectiveId)
  );
}

export function perspectiveById(id: FacetPerspectiveId): FacetPerspectiveDef {
  return PERSPECTIVE_BY_ID.get(id) ?? FACET_PERSPECTIVES[0]!;
}

/**
 * The perspective's group order, completed with any registry groups it
 * didn't mention (appended in FACET_GROUPS order) so the set is exhaustive.
 */
export function groupOrderForPerspective(
  id: FacetPerspectiveId,
): FacetGroupDef["id"][] {
  const order = perspectiveById(id).groupOrder;
  const seen = new Set(order);
  const rest = FACET_GROUPS.map((g) => g.id).filter((gid) => !seen.has(gid));
  return [...order, ...rest];
}

/** Group defs in this perspective's order — drives the facet manager. */
export function orderedGroupDefsForPerspective(
  id: FacetPerspectiveId,
): FacetGroupDef[] {
  const byId = new Map(FACET_GROUPS.map((g) => [g.id, g] as const));
  return groupOrderForPerspective(id)
    .map((gid) => byId.get(gid))
    .filter((g): g is FacetGroupDef => g !== undefined);
}

/** Facet keys grouped + ordered by this perspective — the sidebar order. */
export function sectionOrderForPerspective(id: FacetPerspectiveId): string[] {
  return orderedGroupDefsForPerspective(id).flatMap((g) => g.keys);
}

/**
 * Maps a facet field key to its `has:`/`none:` toggle value. A field
 * listed here grows a pinned "(none)" row at the bottom of the section
 * that adds `NOT none:<value>` (i.e. "show only traces where this is
 * present") on first click and `none:<value>` ("show only traces
 * where this is absent") on second click — the toggle cycles
 * present → absent → cleared.
 *
 * Coverage criteria: any field where "is this set or not" is itself a
 * useful filter, not just "what value does it have". errorMessage is
 * the canonical case — users care about "any error" / "no error"
 * almost as often as they care about a specific error string.
 * Annotation / scenarioRun / selectedPrompt / lastUsedPrompt /
 * promptVersion / evaluatorVerdict / evaluatorScore all have the same
 * present/absent shape that's worth surfacing as a one-click filter.
 */
export const NONE_TOGGLE_VALUE: Record<string, string> = {
  user: "user",
  conversation: "conversation",
  customer: "customer",
  topic: "topic",
  subtopic: "subtopic",
  label: "label",
  evaluator: "eval",
  errorMessage: "errorMessage",
  annotation: "annotation",
  scenarioRun: "scenarioRun",
  selectedPrompt: "selectedPrompt",
  lastUsedPrompt: "lastUsedPrompt",
  promptVersion: "promptVersion",
  evaluatorVerdict: "evaluatorVerdict",
  evaluatorScore: "evaluatorScore",
  event: "event",
  // Round-3 additions matched by the backend's HAS_NONE_VALUES +
  // meta-handlers. Each one is a single-column check on trace_summaries
  // so the cost of "show only traces missing this field" is the same as
  // any other categorical predicate.
  model: "model",
  service: "service",
  traceName: "traceName",
  rootSpanType: "rootSpanType",
};

/**
 * Values shown inside a facet before the "+N more" expander. Kept low so a
 * facet column reads at a glance; the rest are one click (or a search) away.
 */
export const MAX_VISIBLE_FACETS = 5;
/**
 * Cap for the "show more" expansion. The backend `discover` query
 * returns up to TOP_N=50 facet values per section; mirroring that
 * here lets the user see EVERY value the backend returned without
 * having to fall back to the always-on search input. If the section
 * has more than 50 distinct values they don't surface in the top
 * response at all — only via the type-and-Enter search path.
 */
export const MAX_EXPANDED_FACETS = 50;
/** Sections with at most this many values get auto-expanded. */
export const AUTO_EXPAND_THRESHOLD = 5;

/**
 * Attribute sections (Trace / Span / Event attributes, Metadata) can
 * discover 30+ keys. We render only the top-N (already sorted by count
 * desc) with a quiet "Show N more" expander for the rest, so a high-
 * cardinality attribute map doesn't balloon the sidebar. The key filter
 * still searches the FULL set; the cap only applies to the unfiltered list.
 */
export const MAX_VISIBLE_ATTRIBUTE_KEYS = 10;

/**
 * Max distinct values a numeric facet may have to offer the "Discrete"
 * tick-list. Above this it stays a slider even when flagged `discrete` in the
 * backend registry — ticking dozens of integers is worse than a range drag.
 */
export const DISCRETE_MODE_MAX_VALUES = 30;

/**
 * The "easy mode" set of facet keys shown by default in **comfortable**
 * density. Curated to the handful of cross-cutting filters that almost
 * every workflow needs — status, origin, model, who, when, how much.
 * Anything outside this set still appears in **compact** density (which
 * preserves the historical "show me all 40+ facets" engineering view)
 * and can be added back individually via the per-user "+ Add facet"
 * menu when on comfortable.
 *
 * Density change ↔ sidebar coupling: see `useFilterSidebarData` for the
 * runtime filter that consumes this set.
 */
export const COMFORTABLE_DEFAULT_SECTIONS: ReadonlySet<string> = new Set([
  "origin",
  "status",
  "errorMessage",
  "service",
  "model",
  "user",
  "conversation",
  "duration",
  "cost",
  "tokens",
  "evaluator",
]);

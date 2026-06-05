import type { Tokens } from "@chakra-ui/react";
import {
  Activity,
  AlertCircle,
  BookMarked,
  Bookmark,
  Boxes,
  Brain,
  Calculator,
  CheckSquare,
  Clock,
  Compass,
  Database,
  DollarSign,
  FileText,
  Gauge,
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
import { ORIGIN_COLORS, STATUS_COLORS } from "../../utils/formatters";

/** Section key for the trace-level Attributes block (reads `Attributes` map on `trace_summaries`). */
export const ATTRIBUTES_SECTION_KEY = "__attributes__";

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
 * Status keeps a fixed traffic-light mapping. Origin uses a curated
 * mapping shared with the rest of the app (`~/utils/originColors.ts`)
 * so "evaluation" is always green, "application" always blue, etc.
 * Span Type still hashes — the value set is open-ended.
 */
export const FACET_COLORS: Record<string, Record<string, Tokens["colors"]>> = {
  status: STATUS_COLORS,
  origin: ORIGIN_COLORS,
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
};

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
  event: Activity,
  cost: DollarSign,
  duration: Clock,
  ttft: Timer,
  ttlt: TimerReset,
  tokens: Hash,
  promptTokens: Hash,
  completionTokens: Hash,
  tokensPerSecond: Gauge,
  metadataKeys: Database,
  selectedPrompt: BookMarked,
  lastUsedPrompt: History,
  promptVersion: Hash,
  spanName: FileText,
  spanStatus: Activity,
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
  origin: Compass,
  model: Sparkles,
  cost: DollarSign,
  errors: AlertCircle,
  quality: CheckSquare,
  events: Activity,
  subjects: Users,
  topics: Tag,
  custom: Database,
};

export interface FacetGroupDef {
  id:
    | "origin"
    | "model"
    | "cost"
    | "errors"
    | "quality"
    | "events"
    | "subjects"
    | "topics"
    | "custom";
  label: string;
  keys: string[];
}

/**
 * AI-observability-focused taxonomy used by the FacetManagerPopover.
 * Replaces the shape-based Trace / Subjects / Span / Evaluators /
 * Metrics / Prompts grouping with one organised around the questions
 * operators open the trace explorer asking. Order matches the user's
 * stated preference: Origin → Model → Cost → Errors → Quality →
 * Events → Subjects → Topics → Custom.
 *
 * The sidebar itself no longer renders these headings — it's a flat,
 * drag-reorderable list of facets. This grouping is the popover's
 * "browse what's available" structure only.
 */
export const FACET_GROUPS: FacetGroupDef[] = [
  {
    // "What kind of trace is this?" — origin axis. rootSpanType lives
    // here because in practice operators slice by "what kind of work
    // produced this trace" (workflow / agent / chain) at the same
    // moment they pick origin. traceName is the human-readable label
    // that turns rootSpanType into something readable.
    id: "origin",
    label: "Origin",
    keys: ["origin", "rootSpanType", "traceName"],
  },
  {
    // "Which model is this?" — the routing axis operators slice by
    // every day when triaging a regression or a cost spike.
    id: "model",
    label: "Model",
    keys: ["model", "service"],
  },
  {
    // "How much is it costing and how slow is it?" — the resource axis.
    // Tokens grouped here because token counts are the proxy operators
    // reach for when explaining cost variance.
    id: "cost",
    label: "Cost & Performance",
    keys: [
      "cost",
      "tokens",
      "promptTokens",
      "completionTokens",
      "duration",
      "ttft",
      "ttlt",
      "tokensPerSecond",
      "tokensEstimated",
      "spans",
    ],
  },
  {
    // "What's broken?" — the error axis. status / errorMessage /
    // guardrail / containsAi are all "did something go wrong /
    // need intervention" filters.
    id: "errors",
    label: "Errors",
    keys: ["status", "errorMessage", "guardrail", "containsAi"],
  },
  {
    // "Is the AI any good?" — the eval + human-feedback axis.
    // Annotations sit here because they're the human-in-the-loop
    // quality signal that pairs with evaluator output.
    id: "quality",
    label: "Quality",
    keys: [
      "evaluator",
      "evaluatorStatus",
      "evaluatorVerdict",
      "evaluatorScore",
      "annotation",
    ],
  },
  {
    // "What happened during the trace?" — the per-span / per-event
    // axis. Useful for "show me traces that called a particular tool"
    // or "traces with a specific event type".
    id: "events",
    label: "Events",
    keys: ["event", "spanType", "spanName", "spanStatus"],
  },
  {
    // "Who is using it?" — the identity axis. User / conversation /
    // customer / scenarioRun are the "scope to a person, session,
    // tenant, or simulator run" filters.
    id: "subjects",
    label: "Subjects",
    keys: ["user", "conversation", "customer", "scenarioRun"],
  },
  {
    // "What is this trace about?" — the semantic-clustering axis.
    // Topic + subtopic + label come from the automatic clustering
    // pipeline, so they're the answer to "what theme is this".
    id: "topics",
    label: "Topics",
    keys: ["topic", "subtopic", "label"],
  },
  {
    // Project-specific power-user fields. Custom attributes and prompt
    // configuration filters live here because they only make sense
    // once an operator's already established the higher-axis narrative.
    id: "custom",
    label: "Custom",
    keys: [
      ATTRIBUTES_SECTION_KEY,
      SPAN_ATTRIBUTES_SECTION_KEY,
      EVENT_ATTRIBUTES_SECTION_KEY,
      "selectedPrompt",
      "lastUsedPrompt",
      "promptVersion",
    ],
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

export const MAX_VISIBLE_FACETS = 10;
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
/** When a value-list reaches this size, show an inline filter input. */
export const SEARCHABLE_VALUE_THRESHOLD = 5;

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

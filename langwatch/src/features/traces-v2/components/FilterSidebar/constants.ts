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
  ListTree,
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
 * Status keeps a fixed traffic-light mapping. Origin and Span Type are hashed
 * deterministically per value.
 */
export const FACET_COLORS: Record<string, Record<string, Tokens["colors"]>> = {
  status: STATUS_COLORS,
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
  rootSpanName: FileText,
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

export const GROUP_ICONS: Record<string, LucideIcon> = {
  trace: ListTree,
  subjects: Users,
  span: Boxes,
  evaluation: CheckSquare,
  metadata: Database,
};

export interface FacetGroupDef {
  id: "trace" | "subjects" | "span" | "evaluators" | "metrics" | "prompts";
  label: string;
  keys: string[];
}

/**
 * Visual grouping for the filter sidebar. Mirrors the canonical
 * `SearchFieldGroup` taxonomy in `query-language/metadata.ts`
 * (trace / span / eval / metrics) so the sidebar groups, search-bar
 * dropdown sections, and field metadata all agree. Group order is fixed;
 * within a group sections follow the listed order (and may be reordered by
 * the user via DnD — but only inside the same group).
 *
 * There's no standalone "events" group: span events are hoisted onto the
 * trace at ingest, so the `event` facet (event name) is a trace-level
 * filter and lives in the Trace group with the other trace facets.
 */
export const FACET_GROUPS: FacetGroupDef[] = [
  {
    // Trace-level facets: properties of the whole trace, plus the root span's
    // identity, plus span events (hoisted to the trace at ingest), plus
    // model/service rolled up across all spans. The Attributes section
    // reads `trace_summaries.Attributes` (trace.attribute.* keys), so it
    // belongs here too.
    id: "trace",
    label: "Trace",
    keys: [
      "origin",
      "status",
      "errorMessage",
      "guardrail",
      "containsAi",
      "rootSpanType",
      "rootSpanName",
      "model",
      "service",
      "topic",
      "subtopic",
      "label",
      "event",
      ATTRIBUTES_SECTION_KEY,
      EVENT_ATTRIBUTES_SECTION_KEY,
    ],
  },
  {
    // Who/what is this trace about? End user, conversation thread, paying
    // customer, and (when produced by a simulator) the scenario run that
    // emitted it. Splitting these out of the Trace block makes the sidebar
    // legible at a glance — "Subjects" is the axis you scope to a person
    // or session, not the axis of trace-shape properties.
    id: "subjects",
    label: "Subjects",
    keys: ["user", "conversation", "customer", "scenarioRun"],
  },
  {
    // Span-level facets: "this trace contains *any* span where …".
    id: "span",
    label: "Span",
    keys: ["spanName", "spanType", "spanStatus", SPAN_ATTRIBUTES_SECTION_KEY],
  },
  {
    id: "evaluators",
    label: "Evaluators",
    keys: [
      "annotation",
      "evaluator",
      "evaluatorStatus",
      "evaluatorVerdict",
      "evaluatorScore",
    ],
  },
  {
    id: "metrics",
    label: "Metrics",
    keys: [
      "duration",
      "cost",
      "tokens",
      "promptTokens",
      "completionTokens",
      "ttft",
      "ttlt",
      "tokensPerSecond",
      "tokensEstimated",
      "spans",
    ],
  },
  {
    id: "prompts",
    label: "Prompts",
    keys: ["selectedPrompt", "lastUsedPrompt", "promptVersion"],
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

/** Maps a facet field key to its `has:`/`none:` value. */
export const NONE_TOGGLE_VALUE: Record<string, string> = {
  user: "user",
  conversation: "conversation",
  customer: "customer",
  topic: "topic",
  subtopic: "subtopic",
  label: "label",
  evaluator: "eval",
};

export const MAX_VISIBLE_FACETS = 10;
export const MAX_EXPANDED_FACETS = 30;
/** Sections with at most this many values get auto-expanded. */
export const AUTO_EXPAND_THRESHOLD = 5;
/** When a value-list reaches this size, show an inline filter input. */
export const SEARCHABLE_VALUE_THRESHOLD = 5;

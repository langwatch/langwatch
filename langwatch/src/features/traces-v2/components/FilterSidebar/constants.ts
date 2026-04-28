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
  MessageSquare,
  Server,
  Shield,
  Sparkles,
  Tag,
  Timer,
  TimerReset,
  User,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Tokens } from "@chakra-ui/react";
import { STATUS_COLORS } from "../../utils/formatters";
import { FIELD_VALUES } from "../../utils/queryParser";

export const ATTRIBUTES_SECTION_KEY = "__attributes__";

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
  [ATTRIBUTES_SECTION_KEY]: Database,
};

export const GROUP_ICONS: Record<string, LucideIcon> = {
  trace: ListTree,
  span: Boxes,
  evaluation: CheckSquare,
  metadata: Database,
};

export interface FacetGroupDef {
  id:
    | "trace"
    | "prompts"
    | "metrics"
    | "evaluators"
    | "events"
    | "attributes";
  label: string;
  keys: string[];
}

/**
 * Visual grouping for the filter sidebar. Group order is fixed; within a group
 * sections follow the listed order (and may be reordered by the user via DnD —
 * but only inside the same group).
 */
export const FACET_GROUPS: FacetGroupDef[] = [
  {
    id: "trace",
    label: "Trace",
    keys: [
      "origin",
      "status",
      "errorMessage",
      "guardrail",
      "containsAi",
      "annotation",
      "rootSpanType",
      "rootSpanName",
      "spanType",
      "model",
      "service",
      "user",
      "conversation",
      "topic",
      "subtopic",
      "label",
      "tokensEstimated",
    ],
  },
  {
    id: "prompts",
    label: "Prompts",
    keys: ["selectedPrompt", "lastUsedPrompt", "promptVersion"],
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
      "spans",
    ],
  },
  {
    id: "evaluators",
    label: "Evaluators",
    keys: ["evaluator", "evaluatorStatus", "evaluatorVerdict", "evaluatorScore"],
  },
  {
    id: "events",
    label: "Events",
    keys: ["event"],
  },
  {
    id: "attributes",
    label: "Attributes",
    keys: [ATTRIBUTES_SECTION_KEY],
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
/** Top-K most common attribute keys whose values get prefetched on mount. */
export const PREFETCH_TOP_ATTRIBUTE_KEYS = 8;

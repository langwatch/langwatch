import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import type { TraceOriginService } from "./trace-origin.service";
import { parseJsonStringArray, stringAttr } from "./trace-summary.utils";

export const RESOURCE_ATTR_MAPPINGS = [
  ["telemetry.sdk.name", "sdk.name"],
  ["telemetry.sdk.version", "sdk.version"],
  ["telemetry.sdk.language", "sdk.language"],
  ["service.name", "service.name"],
] as const;

export const SPAN_ATTR_MAPPINGS = [
  [ATTR_KEYS.GEN_AI_CONVERSATION_ID, "gen_ai.conversation.id"],
  [ATTR_KEYS.LANGWATCH_USER_ID, "langwatch.user_id"],
  [ATTR_KEYS.LANGWATCH_CUSTOMER_ID, "langwatch.customer_id"],
  [ATTR_KEYS.GEN_AI_AGENT_NAME, "gen_ai.agent.name"],
  [ATTR_KEYS.GEN_AI_AGENT_ID, "gen_ai.agent.id"],
  [ATTR_KEYS.GEN_AI_PROVIDER_NAME, "gen_ai.provider.name"],
  // The model's reasoning effort SETTING (low/medium/high/...), distinct
  // from the reasoning TOKEN count. Hoisted to the trace attribute map so
  // the drawer header can show it next to the model — the same lift that
  // surfaces the conversation id. First non-empty span value wins.
  [
    ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT,
    "gen_ai.request.reasoning_effort",
  ],
  [ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID, "langgraph.thread_id"],
  // AI Gateway markers — stamped on every gateway-emitted customer span by
  // services/aigateway/adapters/customertracebridge/emitter.go so the
  // downstream gatewayBudgetSync reactor can tell which VK / request fold
  // into which budget. Without this allowlist entry the keys are dropped
  // at accumulation time, the reactor early-returns, and CH
  // gateway_budget_ledger_events stays empty.
  ["langwatch.virtual_key_id", "langwatch.virtual_key_id"],
  ["langwatch.gateway_request_id", "langwatch.gateway_request_id"],
  // Governance ingest markers — stamped on every span by the
  // /api/ingest/otel/:sourceId receiver (langwatch/src/server/routes/ingest/ingestionRoutes.ts).
  // Hoisted into trace_summaries so the ActivityMonitorService dashboard
  // queries can roll up spend / users / events by ingestion source without
  // having to scan stored_spans. The receiver is the only emitter of
  // these keys; non-governance traces never carry them.
  ["langwatch.origin.kind", "langwatch.origin.kind"],
  ["langwatch.ingestion_source.id", "langwatch.ingestion_source.id"],
  [
    "langwatch.ingestion_source.organization_id",
    "langwatch.ingestion_source.organization_id",
  ],
  [
    "langwatch.ingestion_source.source_type",
    "langwatch.ingestion_source.source_type",
  ],
] as const;

/**
 * Resource attributes that carry trace identity (thread_id, user_id,
 * customer_id) need to be promoted to their canonical trace-summary
 * forms. The REST collector (`/api/collector`) writes the
 * `metadata.thread_id` field as a RESOURCE attribute (see
 * `collectorSpan.utils.ts#buildResource`), but the canonicalisation
 * extractor that maps to `gen_ai.conversation.id` only runs on
 * per-SPAN attributes. Without this hoist a trace posted via the docs
 * `metadata: { thread_id: "..." }` example never picks up a
 * conversationId and conversation grouping silently breaks.
 *
 * Each entry: list of resource keys to look at (priority order) → the
 * canonical trace-summary key we want to populate.
 */
export const RESOURCE_ATTR_CANONICAL_MAPPINGS = [
  {
    sources: [
      ATTR_KEYS.LANGWATCH_THREAD_ID, // langwatch.thread.id (new dotted form)
      ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY, // langwatch.thread_id
      ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID,
      "metadata.thread_id",
    ],
    dest: "gen_ai.conversation.id",
  },
  {
    sources: [
      ATTR_KEYS.LANGWATCH_USER_ID, // langwatch.user.id (new dotted form)
      ATTR_KEYS.LANGWATCH_USER_ID_LEGACY, // langwatch.user_id
      "metadata.user_id",
    ],
    dest: "langwatch.user_id",
  },
  {
    sources: [
      ATTR_KEYS.LANGWATCH_CUSTOMER_ID, // langwatch.customer.id
      ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY, // langwatch.customer_id
      "metadata.customer_id",
    ],
    dest: "langwatch.customer_id",
  },
] as const;

/**
 * Resource attributes that carry a cost-classification signal rather than
 * trace identity. They are consumed per span at fold time (the bundled
 * portion is rolled into NonBilledCost) and must NOT be hoisted onto the
 * trace's attribute map — a trace's cost split is two real amounts, not a
 * single trace-level boolean. Existing rows that still carry the key keep it;
 * the read layer treats the column as authoritative and the key as a
 * fallback only.
 */
const NON_HOISTED_RESOURCE_KEYS: ReadonlySet<string> = new Set([
  "langwatch.cost.non_billable",
]);

export const STANDARD_RESOURCE_PREFIXES = [
  "host.",
  "process.",
  "telemetry.",
  "service.",
  "os.",
  "container.",
  "k8s.",
  "cloud.",
  "deployment.",
  "device.",
  "faas.",
  "webengine.",
] as const;

/**
 * Extracts per-span attributes and merges them into trace-level attributes,
 * handling labels union, prompt ID collection, metadata deep-merge,
 * origin hoisting, and PII redaction tracking.
 */
export class TraceAttributeAccumulationService {
  constructor(private readonly traceOriginService: TraceOriginService) {}

  extractAttributes(span: NormalizedSpan): Record<string, string> {
    const result: Record<string, string> = {};
    const spanAttrs = span.spanAttributes;
    const resourceAttrs = span.resourceAttributes;

    for (const [source, dest] of RESOURCE_ATTR_MAPPINGS) {
      const v = resourceAttrs[source];
      if (typeof v === "string") result[dest] = v;
    }

    for (const [key, value] of Object.entries(resourceAttrs)) {
      if (STANDARD_RESOURCE_PREFIXES.some((p) => key.startsWith(p))) continue;
      if (NON_HOISTED_RESOURCE_KEYS.has(key)) continue;
      // Normalize langwatch.metadata.* resource attributes to metadata.* canonical form
      const normalizedKey = key.startsWith("langwatch.metadata.")
        ? key.replace("langwatch.metadata.", "metadata.")
        : key;
      if (typeof value === "string") result[normalizedKey] = value;
      else if (typeof value === "number" || typeof value === "boolean")
        result[normalizedKey] = String(value);
    }

    // Promote resource-level identity attrs (thread/user/customer) to
    // their canonical trace-summary keys. Runs BEFORE SPAN_ATTR_MAPPINGS
    // so a span-level value still wins when both are present.
    for (const { sources, dest } of RESOURCE_ATTR_CANONICAL_MAPPINGS) {
      if (result[dest]) continue;
      for (const source of sources) {
        const v = resourceAttrs[source] ?? result[source];
        if (typeof v === "string" && v.length > 0) {
          result[dest] = v;
          break;
        }
      }
    }

    for (const [source, dest] of SPAN_ATTR_MAPPINGS) {
      const v = spanAttrs[source];
      if (typeof v === "string") result[dest] = v;
    }

    const origin = stringAttr(spanAttrs, "langwatch.origin");
    if (origin) result["langwatch.origin"] = origin;

    const scenarioRunId = stringAttr(spanAttrs, "scenario.run_id");
    if (scenarioRunId) result["scenario.run_id"] = scenarioRunId;

    const evaluationRunId = stringAttr(spanAttrs, "evaluation.run_id");
    if (evaluationRunId) result["evaluation.run_id"] = evaluationRunId;

    const labels = spanAttrs[ATTR_KEYS.LANGWATCH_LABELS];
    if (typeof labels === "string") result["langwatch.labels"] = labels;
    else if (Array.isArray(labels))
      result["langwatch.labels"] = JSON.stringify(labels);

    // `tag.tags` is the reserved labels key of the legacy OTLP path
    // (otel.traces.ts maps it to reservedTraceMetadata.labels) and what the
    // Langy worker emits via OPENCODE_RESOURCE_ATTRIBUTES (tag.tags=langy).
    // Honor the same contract here: fold span- or resource-level tag.tags
    // (comma-separated string or array) into langwatch.labels so the trace
    // actually carries the tag in the UI/filters. langwatch.labels wins on
    // conflict; tag.tags values are unioned in.
    const tagTags = spanAttrs["tag.tags"] ?? resourceAttrs["tag.tags"];
    const tagList = Array.isArray(tagTags)
      ? tagTags.filter((t): t is string => typeof t === "string")
      : typeof tagTags === "string"
        ? tagTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    if (tagList.length > 0) {
      const existing = parseJsonStringArray(result["langwatch.labels"]);
      result["langwatch.labels"] = JSON.stringify([
        ...new Set([...existing, ...tagList]),
      ]);
    }

    const promptId = stringAttr(spanAttrs, "langwatch.prompt.id");
    if (promptId?.includes(":")) {
      result["langwatch.prompt.id"] = promptId;
    }

    for (const [key, value] of Object.entries(spanAttrs)) {
      if (!key.startsWith("metadata.")) continue;
      if (typeof value === "string") result[key] = value;
      else if (value !== null && value !== undefined) {
        result[key] =
          typeof value === "object" ? JSON.stringify(value) : String(value);
      }
    }

    return result;
  }

  accumulateAttributes({
    state,
    span,
    outputSource,
    inputIsFallback,
    outputIsFallback,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    outputSource: string;
    inputIsFallback: boolean;
    outputIsFallback: boolean;
  }): Record<string, string> {
    const spanAttrs = this.extractAttributes(span);
    const merged = { ...spanAttrs, ...state.attributes };

    // Labels: union across spans
    const existingLabels = state.attributes["langwatch.labels"];
    const newLabels = spanAttrs["langwatch.labels"];
    if (existingLabels || newLabels) {
      const union = [
        ...new Set([
          ...parseJsonStringArray(existingLabels),
          ...parseJsonStringArray(newLabels),
        ]),
      ];
      if (union.length > 0) merged["langwatch.labels"] = JSON.stringify(union);
    }

    // Prompt IDs: union across spans
    const existingPromptIds = state.attributes["langwatch.prompt_ids"];
    const newPromptId = spanAttrs["langwatch.prompt.id"];
    if (existingPromptIds || newPromptId) {
      const union = [
        ...new Set([
          ...parseJsonStringArray(existingPromptIds),
          ...(newPromptId ? [newPromptId] : []),
        ]),
      ];
      if (union.length > 0)
        merged["langwatch.prompt_ids"] = JSON.stringify(union);
    }
    // Remove the per-span key so it doesn't leak into trace-level attributes
    delete merged["langwatch.prompt.id"];

    // Metadata: deep-merge JSON objects, first-wins for primitives
    for (const key of Object.keys(merged)) {
      if (!key.startsWith("metadata.")) continue;
      const prev = state.attributes[key];
      const next = spanAttrs[key];
      if (!prev || !next) continue;
      try {
        const prevObj: unknown = JSON.parse(prev);
        const nextObj: unknown = JSON.parse(next);
        if (
          typeof prevObj === "object" &&
          prevObj &&
          !Array.isArray(prevObj) &&
          typeof nextObj === "object" &&
          nextObj &&
          !Array.isArray(nextObj)
        ) {
          merged[key] = JSON.stringify({ ...nextObj, ...prevObj });
        }
      } catch {
        /* not JSON - keep first-wins */
      }
    }

    this.traceOriginService.stripLegacyMarkers(merged);
    this.traceOriginService.hoistOrigin({
      state,
      span,
      mergedAttributes: merged,
    });
    this.traceOriginService.hoistSource({
      state,
      span,
      mergedAttributes: merged,
    });

    merged["langwatch.reserved.output_source"] = outputSource;
    if (inputIsFallback) {
      merged["langwatch.reserved.input_is_fallback"] = "true";
    } else {
      delete merged["langwatch.reserved.input_is_fallback"];
    }
    if (outputIsFallback) {
      merged["langwatch.reserved.output_is_fallback"] = "true";
    } else {
      delete merged["langwatch.reserved.output_is_fallback"];
    }

    // PII redaction status tracking - accumulate span IDs by severity
    const piiStatus =
      span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS];
    if (piiStatus === "partial" || piiStatus === "none") {
      const key =
        piiStatus === "partial"
          ? ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS
          : ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS;
      const ids = parseJsonStringArray(merged[key]);
      ids.push(span.spanId);
      merged[key] = JSON.stringify(ids);
    }

    return merged;
  }
}

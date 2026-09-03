/**
 * Reads ONE span's attributes into the shape a trace summary uses.
 *
 * Separate from accumulation because it is a different job with a different
 * dependency: this reads a span and needs nothing else, while folding those
 * readings across a trace needs the origin service. Keeping them in one class
 * put a 190-line mapping vocabulary in the same file as the fold rules.
 */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { parseJsonStringArray, stringAttr } from "./trace-summary-attributes.rules";

const VERCEL_METADATA_PREFIX = "ai.telemetry.metadata.";

/**
 * Metadata names that identify a trace rather than describe it, and the
 * trace-summary key each one fills. Both spellings are accepted because the
 * REST collector accepts both and callers copy whichever they already use.
 */
const VERCEL_RESERVED_METADATA: Readonly<Record<string, string>> = {
  thread_id: "gen_ai.conversation.id",
  threadId: "gen_ai.conversation.id",
  user_id: "langwatch.user_id",
  userId: "langwatch.user_id",
  customer_id: "langwatch.customer_id",
  customerId: "langwatch.customer_id",
};

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
  [ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT, "gen_ai.request.reasoning_effort"],
  [ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID, "langgraph.thread_id"],
  // AI Gateway markers — stamped on every gateway-emitted customer span by
  // services/aigateway/adapters/customertracebridge/emitter.go. They are
  // what joins a trace back to the key and the request that produced it,
  // which is the read the gateway usage views and per-key spend serve.
  // Budget debits do not come from here: they ride the gateway's own spend
  // commands, which carry attribution the trace never sees.
  ["langwatch.virtual_key_id", "langwatch.virtual_key_id"],
  ["langwatch.gateway_request_id", "langwatch.gateway_request_id"],
  // The provider the request was actually dispatched to (a ModelProvider
  // row id), so usage views can break spend down by the vendor that served
  // the call.
  ["langwatch.model_provider_id", "langwatch.model_provider_id"],
  // The model name the client sent, present only when a routing policy
  // rewrote it. gen_ai.request.model holds the model that was dispatched,
  // so this is what answers which tier or which legacy name a caller uses.
  ["langwatch.requested_model", "langwatch.requested_model"],
  // Governance ingest markers — stamped on every span by the
  // /api/ingest/otel/:sourceId receiver (platform/app/src/server/routes/ingest/ingestionRoutes.ts).
  // Hoisted into trace_summaries so the ActivityMonitorService dashboard
  // queries can roll up spend / users / events by ingestion source without
  // having to scan stored_spans. The receiver is the only emitter of
  // these keys; non-governance traces never carry them.
  ["langwatch.origin.kind", "langwatch.origin.kind"],
  ["langwatch.ingestion_source.id", "langwatch.ingestion_source.id"],
  ["langwatch.ingestion_source.organization_id", "langwatch.ingestion_source.organization_id"],
  ["langwatch.ingestion_source.source_type", "langwatch.ingestion_source.source_type"],
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
const NON_HOISTED_RESOURCE_KEYS: ReadonlySet<string> = new Set(["langwatch.cost.non_billable"]);

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

export class TraceAttributeExtractionService {
  private constructor() {}

  static create(): TraceAttributeExtractionService {
    return new TraceAttributeExtractionService();
  }

  extractAttributes(span: NormalizedSpan): Record<string, string> {
    const result: Record<string, string> = {};
    const spanAttrs = span.spanAttributes;
    const resourceAttrs = span.resourceAttributes;

    // Order is the contract: a later step may overwrite what an earlier one
    // wrote, and the identity step deliberately only fills what is still empty.
    this.applyResourceAttributes({ resourceAttrs, result });
    this.applyResourceIdentity({ resourceAttrs, result });
    this.applySpanAttributes({ spanAttrs, result });
    this.applyLabels({ spanAttrs, resourceAttrs, result });
    this.applyVercelTelemetryMetadata({ spanAttrs, result });
    this.applyCustomMetadata({ spanAttrs, result });

    return result;
  }

  private applyResourceAttributes({
    resourceAttrs,
    result,
  }: {
    resourceAttrs: NormalizedSpan["resourceAttributes"];
    result: Record<string, string>;
  }): void {
    for (const [source, dest] of RESOURCE_ATTR_MAPPINGS) {
      const v = resourceAttrs[source];
      if (typeof v === "string") {
        result[dest] = v;
      }
    }

    for (const [key, value] of Object.entries(resourceAttrs)) {
      if (STANDARD_RESOURCE_PREFIXES.some((p) => key.startsWith(p))) {
        continue;
      }
      if (NON_HOISTED_RESOURCE_KEYS.has(key)) {
        continue;
      }
      // Normalize langwatch.metadata.* resource attributes to metadata.* canonical form
      const normalizedKey = key.startsWith("langwatch.metadata.")
        ? key.replace("langwatch.metadata.", "metadata.")
        : key;
      if (typeof value === "string") {
        result[normalizedKey] = value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        result[normalizedKey] = String(value);
      }
    }
  }

  private applyResourceIdentity({
    resourceAttrs,
    result,
  }: {
    resourceAttrs: NormalizedSpan["resourceAttributes"];
    result: Record<string, string>;
  }): void {
    // Promote resource-level identity attrs (thread/user/customer) to
    // their canonical trace-summary keys. Runs BEFORE SPAN_ATTR_MAPPINGS
    // so a span-level value still wins when both are present.
    for (const { sources, dest } of RESOURCE_ATTR_CANONICAL_MAPPINGS) {
      if (result[dest]) {
        continue;
      }
      for (const source of sources) {
        const v = resourceAttrs[source] ?? result[source];
        if (typeof v === "string" && v.length > 0) {
          result[dest] = v;
          break;
        }
      }
    }
  }

  private applySpanAttributes({
    spanAttrs,
    result,
  }: {
    spanAttrs: NormalizedSpan["spanAttributes"];
    result: Record<string, string>;
  }): void {
    for (const [source, dest] of SPAN_ATTR_MAPPINGS) {
      const v = spanAttrs[source];
      if (typeof v === "string") {
        result[dest] = v;
      }
    }

    const origin = stringAttr(spanAttrs, "langwatch.origin");
    if (origin) {
      result["langwatch.origin"] = origin;
    }

    const scenarioRunId = stringAttr(spanAttrs, "scenario.run_id");
    if (scenarioRunId) {
      result["scenario.run_id"] = scenarioRunId;
    }

    const evaluationRunId = stringAttr(spanAttrs, "evaluation.run_id");
    if (evaluationRunId) {
      result["evaluation.run_id"] = evaluationRunId;
    }
  }

  private applyLabels({
    spanAttrs,
    resourceAttrs,
    result,
  }: {
    spanAttrs: NormalizedSpan["spanAttributes"];
    resourceAttrs: NormalizedSpan["resourceAttributes"];
    result: Record<string, string>;
  }): void {
    // Labels may arrive on span attrs (OTLP-direct path, where
    // otelAttributesToNestedAttributes JSON-parses the string to an array)
    // or on resource attrs (POST /api/collector and
    // PATCH /api/traces/{id}/metadata, where buildResource writes
    // JSON.stringify(labels) and parseJsonStringValues later converts it
    // back to an array). Honor both sources so labels sent via the
    // documented REST endpoints actually reach the trace's attribute map
    // and the labels facet SQL. Mirrors the tag.tags handling below.
    const labels =
      spanAttrs[ATTR_KEYS.LANGWATCH_LABELS] ?? resourceAttrs[ATTR_KEYS.LANGWATCH_LABELS];
    if (typeof labels === "string") {
      result["langwatch.labels"] = labels;
    } else if (Array.isArray(labels)) {
      result["langwatch.labels"] = JSON.stringify(labels);
    }

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
      result["langwatch.labels"] = JSON.stringify([...new Set([...existing, ...tagList])]);
    }
  }

  private applyCustomMetadata({
    spanAttrs,
    result,
  }: {
    spanAttrs: NormalizedSpan["spanAttributes"];
    result: Record<string, string>;
  }): void {
    const promptId = stringAttr(spanAttrs, "langwatch.prompt.id");
    if (promptId?.includes(":")) {
      result["langwatch.prompt.id"] = promptId;
    }

    for (const [key, value] of Object.entries(spanAttrs)) {
      if (!key.startsWith("metadata.")) {
        continue;
      }
      if (typeof value === "string") {
        result[key] = value;
      } else if (value !== null && value !== undefined) {
        result[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
      }
    }
  }

  private applyVercelTelemetryMetadata({
    spanAttrs,
    result,
  }: {
    spanAttrs: NormalizedSpan["spanAttributes"];
    result: Record<string, string>;
  }): void {
    for (const [key, value] of Object.entries(spanAttrs)) {
      const name = TraceAttributeExtractionService.vercelMetadataName(key);
      if (!name || value === null || value === undefined) {
        continue;
      }

      if (name === "labels" || name === "tags") {
        TraceAttributeExtractionService.unionLabelsInto(
          result,
          TraceAttributeExtractionService.labelList(value),
        );
        continue;
      }

      const reserved = VERCEL_RESERVED_METADATA[name];
      if (reserved) {
        TraceAttributeExtractionService.fillIfEmpty(result, reserved, value);
        continue;
      }

      result[`metadata.${name}`] = TraceAttributeExtractionService.attributeText(value);
    }
  }

  /** The metadata name behind a Vercel telemetry key, or null for any other key. */
  private static vercelMetadataName(key: string): string | null {
    return key.startsWith(VERCEL_METADATA_PREFIX)
      ? key.slice(VERCEL_METADATA_PREFIX.length) || null
      : null;
  }

  /** Labels as an array, whether they arrive as one or as a JSON string. */
  private static labelList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((label): label is string => typeof label === "string")
      : parseJsonStringArray(typeof value === "string" ? value : void 0);
  }

  private static unionLabelsInto(result: Record<string, string>, labels: string[]): void {
    if (labels.length === 0) {
      return;
    }
    const existing = parseJsonStringArray(result[ATTR_KEYS.LANGWATCH_LABELS]);
    result[ATTR_KEYS.LANGWATCH_LABELS] = JSON.stringify([...new Set([...existing, ...labels])]);
  }

  /** Writes the value only when the key has no value yet, so an explicit one wins. */
  private static fillIfEmpty(result: Record<string, string>, key: string, value: unknown): void {
    if (result[key]) {
      return;
    }
    if (typeof value === "string" && value.length > 0) {
      result[key] = value;
    }
  }

  private static attributeText(value: unknown): string {
    return typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  }
}

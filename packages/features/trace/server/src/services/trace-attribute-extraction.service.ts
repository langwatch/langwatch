/**
 * Reads ONE span's attributes into the shape a trace summary uses. Separate from accumulation because it's a different job with a different dependency: this reads a span and needs nothing else, while folding across a trace needs the origin service. One class would have put a 190-line mapping vocabulary beside the fold rules.
 */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { parseJsonStringArray, stringAttr } from "../rules/trace-summary-attributes.rules";

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
  // services/aigateway/adapters/customertracebridge/emitter.go, joining a
  // trace back to the key and request that produced it (gateway usage
  // views, per-key spend). Budget debits don't come from here — they ride
  // the gateway's own spend commands, carrying attribution the trace never sees.
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
  // Governance ingest markers, stamped on every span by the
  // /api/ingest/otel/:sourceId receiver. Hoisted into trace_summaries so
  // the ActivityMonitorService dashboard can roll up spend/users/events by
  // ingestion source without scanning stored_spans. The receiver is the
  // only emitter of these keys; non-governance traces never carry them.
  ["langwatch.origin.kind", "langwatch.origin.kind"],
  ["langwatch.ingestion_source.id", "langwatch.ingestion_source.id"],
  ["langwatch.ingestion_source.organization_id", "langwatch.ingestion_source.organization_id"],
  ["langwatch.ingestion_source.source_type", "langwatch.ingestion_source.source_type"],
] as const;

/**
 * Resource attributes carrying trace identity (thread_id, user_id, customer_id) need promotion to canonical trace-summary forms: the REST collector writes metadata.thread_id as a RESOURCE attribute, but the canonicalisation extractor mapping to gen_ai.conversation.id only runs on per-SPAN attributes — without this hoist, a trace posted via the docs' metadata example never picks up a conversationId. Each entry: resource keys to look at (priority order) -> the canonical trace-summary key to populate.
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
 * Resource attributes carrying a cost-classification signal, not trace identity — consumed per span at fold time (bundled portion rolled into NonBilledCost) and must NOT be hoisted onto the trace's attribute map, since a trace's cost split is two real amounts, not a single boolean. Existing rows keep the key; the read layer treats the column as authoritative and the key as fallback only.
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
    // Labels may arrive on span attrs (OTLP-direct, JSON-parsed to an array)
    // or resource attrs (POST /api/collector, PATCH .../metadata, where
    // buildResource writes JSON.stringify(labels) and parseJsonStringValues
    // converts it back). Honor both so labels sent via documented REST
    // endpoints reach the attribute map and labels facet SQL (mirrors tag.tags below).
    const labels =
      spanAttrs[ATTR_KEYS.LANGWATCH_LABELS] ?? resourceAttrs[ATTR_KEYS.LANGWATCH_LABELS];
    if (typeof labels === "string") {
      result["langwatch.labels"] = labels;
    } else if (Array.isArray(labels)) {
      result["langwatch.labels"] = JSON.stringify(labels);
    }

    // tag.tags is the reserved labels key of the legacy OTLP path (mapped to
    // reservedTraceMetadata.labels) and what the Langy worker emits via
    // OPENCODE_RESOURCE_ATTRIBUTES. Folds span- or resource-level tag.tags
    // (comma-separated string or array) into langwatch.labels so the trace
    // carries the tag; langwatch.labels wins on conflict, tag.tags is unioned in.
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

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
  [ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID, "langgraph.thread_id"],
] as const;

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
      // Normalize langwatch.metadata.* resource attributes to metadata.* canonical form
      const normalizedKey = key.startsWith("langwatch.metadata.")
        ? key.replace("langwatch.metadata.", "metadata.")
        : key;
      if (typeof value === "string") result[normalizedKey] = value;
      else if (typeof value === "number" || typeof value === "boolean")
        result[normalizedKey] = String(value);
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

    const promptId = stringAttr(spanAttrs, "langwatch.prompt.id");
    if (promptId && promptId.includes(":")) {
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
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    outputSource: string;
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
    this.traceOriginService.hoistOrigin({ state, span, mergedAttributes: merged });
    this.traceOriginService.hoistSource({ state, span, mergedAttributes: merged });

    merged["langwatch.reserved.output_source"] = outputSource;

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

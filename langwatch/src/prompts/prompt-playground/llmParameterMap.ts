/**
 * Declarative mapping between playground form fields, OTel GenAI semantic
 * convention attributes, and legacy trace parameter aliases.
 *
 * Each entry describes one LLM parameter that the "Open in Prompts" flow
 * knows how to extract from trace data and populate in the playground form.
 *
 * - `formField`     – key used in `PromptStudioSpanResult.llmConfig` and the
 *                     playground form's `llm` object.
 * - `otelAttr`      – OTel `gen_ai.request.*` attribute name stored in
 *                     ClickHouse span attributes.  `null` when no OTel
 *                     convention exists for this parameter.
 * - `traceAliases`  – legacy / SDK-specific key names found in Elasticsearch
 *                     `span.params`.  First match wins.
 * - `coercion`      – target type for the form field ("number" or "string").
 */

export type ParamCoercion = "number" | "string";

export interface LlmParameterMapping {
  formField: string;
  otelAttr: string | null;
  traceAliases: string[];
  coercion: ParamCoercion;
}

export const LLM_PARAMETER_MAP: readonly LlmParameterMapping[] = [
  {
    formField: "temperature",
    otelAttr: "gen_ai.request.temperature",
    traceAliases: ["temperature"],
    coercion: "number",
  },
  {
    formField: "maxTokens",
    otelAttr: "gen_ai.request.max_tokens",
    traceAliases: ["max_tokens", "maxTokens"],
    coercion: "number",
  },
  {
    formField: "topP",
    otelAttr: "gen_ai.request.top_p",
    traceAliases: ["top_p", "topP"],
    coercion: "number",
  },
  {
    formField: "frequencyPenalty",
    otelAttr: "gen_ai.request.frequency_penalty",
    traceAliases: ["frequency_penalty", "frequencyPenalty"],
    coercion: "number",
  },
  {
    formField: "presencePenalty",
    otelAttr: "gen_ai.request.presence_penalty",
    traceAliases: ["presence_penalty", "presencePenalty"],
    coercion: "number",
  },
  {
    formField: "seed",
    otelAttr: "gen_ai.request.seed",
    traceAliases: ["seed"],
    coercion: "number",
  },
  {
    formField: "topK",
    otelAttr: null,
    traceAliases: ["top_k", "topK"],
    coercion: "number",
  },
  {
    formField: "minP",
    otelAttr: null,
    traceAliases: ["min_p", "minP"],
    coercion: "number",
  },
  {
    formField: "repetitionPenalty",
    otelAttr: null,
    traceAliases: ["repetition_penalty", "repetitionPenalty"],
    coercion: "number",
  },
  {
    formField: "reasoning",
    otelAttr: null,
    traceAliases: [
      "reasoning",
      "reasoning_effort",
      "thinkingLevel",
      "effort",
    ],
    coercion: "string",
  },
  {
    formField: "verbosity",
    otelAttr: null,
    traceAliases: ["verbosity"],
    coercion: "string",
  },
];

/**
 * Set of all known trace-level parameter alias names.
 * Used by the Elasticsearch extractor to separate known LLM parameters
 * (mapped to dedicated fields) from unknown ones (placed in `litellmParams`).
 */
export const KNOWN_PARAM_ALIASES = new Set(
  LLM_PARAMETER_MAP.flatMap((p) => p.traceAliases),
);

/**
 * Declarative mapping between playground form fields and OTel GenAI semantic
 * convention attributes.
 *
 * Each entry describes one LLM parameter that the "Open in Prompts" flow
 * knows how to extract from trace data and populate in the playground form.
 *
 * - `formField`     – key used in `PromptStudioSpanResult.llmConfig` and the
 *                     playground form's `llm` object.
 * - `otelAttr`      – OTel `gen_ai.request.*` attribute name stored in
 *                     ClickHouse span attributes.  `null` when no OTel
 *                     convention exists for this parameter.
 * - `coercion`      – target type for the form field ("number" or "string").
 */

export type ParamCoercion = "number" | "string";

export interface LlmParameterMapping {
  formField: string;
  otelAttr: string | null;
  coercion: ParamCoercion;
}

export const LLM_PARAMETER_MAP: readonly LlmParameterMapping[] = [
  {
    formField: "temperature",
    otelAttr: "gen_ai.request.temperature",
    coercion: "number",
  },
  {
    formField: "maxTokens",
    otelAttr: "gen_ai.request.max_tokens",
    coercion: "number",
  },
  {
    formField: "topP",
    otelAttr: "gen_ai.request.top_p",
    coercion: "number",
  },
  {
    formField: "frequencyPenalty",
    otelAttr: "gen_ai.request.frequency_penalty",
    coercion: "number",
  },
  {
    formField: "presencePenalty",
    otelAttr: "gen_ai.request.presence_penalty",
    coercion: "number",
  },
  {
    formField: "seed",
    otelAttr: "gen_ai.request.seed",
    coercion: "number",
  },
  {
    formField: "topK",
    otelAttr: null,
    coercion: "number",
  },
  {
    formField: "minP",
    otelAttr: null,
    coercion: "number",
  },
  {
    formField: "repetitionPenalty",
    otelAttr: null,
    coercion: "number",
  },
  {
    formField: "reasoning",
    otelAttr: null,
    coercion: "string",
  },
  {
    formField: "verbosity",
    otelAttr: null,
    coercion: "string",
  },
];

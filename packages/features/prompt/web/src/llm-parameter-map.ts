export type ParamCoercion = "number" | "string";
export interface LlmParameterMapping { formField: string; otelAttr: string | null; coercion: ParamCoercion }
export const LLM_PARAMETER_MAP: readonly LlmParameterMapping[] = [
  { formField: "temperature", otelAttr: "gen_ai.request.temperature", coercion: "number" },
  { formField: "maxTokens", otelAttr: "gen_ai.request.max_tokens", coercion: "number" },
  { formField: "topP", otelAttr: "gen_ai.request.top_p", coercion: "number" },
  { formField: "frequencyPenalty", otelAttr: "gen_ai.request.frequency_penalty", coercion: "number" },
  { formField: "presencePenalty", otelAttr: "gen_ai.request.presence_penalty", coercion: "number" },
  { formField: "seed", otelAttr: "gen_ai.request.seed", coercion: "number" },
  { formField: "topK", otelAttr: null, coercion: "number" },
  { formField: "minP", otelAttr: null, coercion: "number" },
  { formField: "repetitionPenalty", otelAttr: null, coercion: "number" },
  { formField: "reasoning", otelAttr: null, coercion: "string" },
  { formField: "verbosity", otelAttr: null, coercion: "string" },
];

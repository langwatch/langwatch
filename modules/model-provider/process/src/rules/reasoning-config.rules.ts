import type { ReasoningConfig, ReasoningEffortOption } from "@langwatch/model-provider-contract";

/**
 * Hardcoded reasoning/thinking parameter configuration per model. OpenRouter
 * does not publish allowed values, so this is maintained by hand from each
 * provider's own API docs (OpenAI, Anthropic, Gemini, xAI, DeepSeek).
 */

const OPENAI_GPT5_PRO: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["high"],
  defaultValue: "high",
  canDisable: false,
};

const OPENAI_GPT51: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["none", "low", "medium", "high"],
  defaultValue: "none",
  canDisable: true,
};

const OPENAI_GPT51_CODEX_MAX: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["none", "low", "medium", "high", "xhigh"],
  defaultValue: "none",
  canDisable: true,
};

const OPENAI_GPT52: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["none", "low", "medium", "high", "xhigh"],
  defaultValue: "none",
  canDisable: true,
};

const OPENAI_O_SERIES: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["low", "medium", "high"],
  defaultValue: "medium",
  canDisable: false,
};

const ANTHROPIC_CLAUDE_OPUS_45: ReasoningConfig = {
  supported: true,
  parameterName: "effort",
  allowedValues: ["low", "medium", "high"],
  defaultValue: "high",
  canDisable: false,
};

const GEMINI_25_FLASH: ReasoningConfig = {
  supported: true,
  parameterName: "thinkingLevel",
  allowedValues: ["none", "low", "high"],
  defaultValue: "low",
  canDisable: true,
};

const GEMINI_25_PRO: ReasoningConfig = {
  supported: true,
  parameterName: "thinkingLevel",
  allowedValues: ["low", "high"],
  defaultValue: "low",
  canDisable: false,
};

const GEMINI_3: ReasoningConfig = {
  supported: true,
  parameterName: "thinkingLevel",
  allowedValues: ["low", "high"],
  defaultValue: "low",
  canDisable: false,
};

const XAI_GROK3_MINI: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["low", "high"],
  defaultValue: "low",
  canDisable: false,
};

const DEEPSEEK_R1: ReasoningConfig = {
  supported: true,
  parameterName: "reasoning_effort",
  allowedValues: ["low", "medium", "high"],
  defaultValue: "medium",
  canDisable: false,
};

/** Ordered: the first rule whose model-id test matches decides the configuration. */
const REASONING_RULES: readonly { matches: (id: string) => boolean; config: ReasoningConfig }[] = [
  {
    matches: (id) => id.includes("openai/") && includesAny(id, ["gpt-5-pro", "gpt-5.2-pro"]),
    config: OPENAI_GPT5_PRO,
  },
  {
    matches: (id) => id.includes("openai/") && includesAny(id, ["gpt-5.2", "gpt-5.3"]),
    config: OPENAI_GPT52,
  },
  {
    matches: (id) => id.includes("openai/") && id.includes("gpt-5.1-codex-max"),
    config: OPENAI_GPT51_CODEX_MAX,
  },
  { matches: (id) => id.includes("openai/") && id.includes("gpt-5.1"), config: OPENAI_GPT51 },
  {
    matches: (id) => id.includes("openai/") && id.includes("gpt-5") && !id.includes("gpt-5."),
    config: OPENAI_O_SERIES,
  },
  {
    matches: (id) => id.includes("openai/") && includesAny(id, ["/o1", "/o3"]),
    config: OPENAI_O_SERIES,
  },
  {
    matches: (id) =>
      id.includes("anthropic/") && includesAny(id, ["claude-opus-4", "claude-4", "claude-5"]),
    config: ANTHROPIC_CLAUDE_OPUS_45,
  },
  {
    matches: (id) => includesAny(id, ["gemini/", "google/"]) && id.includes("gemini-3"),
    config: GEMINI_3,
  },
  {
    matches: (id) => includesAny(id, ["gemini/", "google/"]) && id.includes("gemini-2.5-pro"),
    config: GEMINI_25_PRO,
  },
  {
    matches: (id) => includesAny(id, ["gemini/", "google/"]) && id.includes("gemini-2.5-flash"),
    config: GEMINI_25_FLASH,
  },
  {
    matches: (id) => includesAny(id, ["xai/", "x-ai/"]) && id.includes("grok-3-mini"),
    config: XAI_GROK3_MINI,
  },
  {
    matches: (id) => id.includes("deepseek/") && includesAny(id, ["-r1", "reasoner"]),
    config: DEEPSEEK_R1,
  },
];

/** Reasoning configuration for a model id, or undefined if it takes none. */
export function pickReasoningConfig(modelId: string): ReasoningConfig | undefined {
  const lowerModelId = modelId.toLowerCase();
  return REASONING_RULES.find((rule) => rule.matches(lowerModelId))?.config;
}

/** Whether a model takes a reasoning parameter at all. */
export function supportsReasoning(modelId: string): boolean {
  return pickReasoningConfig(modelId) !== undefined;
}

/** Allowed reasoning-effort values for a model, or empty if it takes none. */
export function getAllowedReasoningValues(modelId: string): readonly ReasoningEffortOption[] {
  return pickReasoningConfig(modelId)?.allowedValues ?? [];
}

/** Default reasoning effort for a model, or undefined if it takes none. */
export function pickDefaultReasoningEffort(modelId: string): ReasoningEffortOption | undefined {
  return pickReasoningConfig(modelId)?.defaultValue;
}

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

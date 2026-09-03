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

/** Reasoning configuration for a model id, or undefined if it takes none. */
export function getReasoningConfig(modelId: string): ReasoningConfig | undefined {
  const lowerModelId = modelId.toLowerCase();

  if (lowerModelId.includes("openai/")) {
    if (lowerModelId.includes("gpt-5-pro") || lowerModelId.includes("gpt-5.2-pro")) {
      return OPENAI_GPT5_PRO;
    }
    if (lowerModelId.includes("gpt-5.2") || lowerModelId.includes("gpt-5.3")) {
      return OPENAI_GPT52;
    }
    if (lowerModelId.includes("gpt-5.1-codex-max")) {
      return OPENAI_GPT51_CODEX_MAX;
    }
    if (lowerModelId.includes("gpt-5.1")) {
      return OPENAI_GPT51;
    }
    if (lowerModelId.includes("gpt-5") && !lowerModelId.includes("gpt-5.")) {
      return OPENAI_O_SERIES;
    }
    if (lowerModelId.includes("/o1") || lowerModelId.includes("/o3")) {
      return OPENAI_O_SERIES;
    }
  }

  if (
    lowerModelId.includes("anthropic/") &&
    (lowerModelId.includes("claude-opus-4") ||
      lowerModelId.includes("claude-4") ||
      lowerModelId.includes("claude-5"))
  ) {
    return ANTHROPIC_CLAUDE_OPUS_45;
  }

  if (lowerModelId.includes("gemini/") || lowerModelId.includes("google/")) {
    if (lowerModelId.includes("gemini-3")) {
      return GEMINI_3;
    }
    if (lowerModelId.includes("gemini-2.5-pro") || lowerModelId.includes("gemini-2.5-pro-")) {
      return GEMINI_25_PRO;
    }
    if (lowerModelId.includes("gemini-2.5-flash") || lowerModelId.includes("gemini-2.5-flash-")) {
      return GEMINI_25_FLASH;
    }
  }

  if (
    (lowerModelId.includes("xai/") || lowerModelId.includes("x-ai/")) &&
    lowerModelId.includes("grok-3-mini")
  ) {
    return XAI_GROK3_MINI;
  }

  if (
    lowerModelId.includes("deepseek/") &&
    (lowerModelId.includes("-r1") || lowerModelId.includes("reasoner"))
  ) {
    return DEEPSEEK_R1;
  }

  return undefined;
}

/** Whether a model takes a reasoning parameter at all. */
export function supportsReasoning(modelId: string): boolean {
  return getReasoningConfig(modelId) !== undefined;
}

/** Allowed reasoning-effort values for a model, or empty if it takes none. */
export function getAllowedReasoningValues(modelId: string): readonly ReasoningEffortOption[] {
  return getReasoningConfig(modelId)?.allowedValues ?? [];
}

/** Default reasoning effort for a model, or undefined if it takes none. */
export function getDefaultReasoningEffort(modelId: string): ReasoningEffortOption | undefined {
  return getReasoningConfig(modelId)?.defaultValue;
}

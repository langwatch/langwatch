export type LangyModelGroup =
  | "quick"
  | "balanced"
  | "reasoning"
  | "multimodal"
  | "custom";

export interface LangyModelProfileSource {
  description?: string;
  supportsImageInput?: boolean;
  supportsAudioInput?: boolean;
  supportsImageOutput?: boolean;
  supportsAudioOutput?: boolean;
  reasoningConfig?: { supported: boolean };
}

export interface LangyModelProfile {
  group: LangyModelGroup;
  isQuick: boolean;
  isLongRunning: boolean;
  hasReasoning: boolean;
  isMultimodal: boolean;
}

const QUICK_NAME =
  /(?:^|[-_.])(flash|haiku|instant|lite|mini|nano|small)(?:$|[-_.])/i;
const QUICK_DESCRIPTION =
  /\b(fast|faster|low[- ]latency|reduced latency|compact)\b/i;
const LONG_RUNNING =
  /\b(deep research|deep-research|research model|long-running)\b/i;

/**
 * Present registry capabilities as user intent. Speed is deliberately called
 * out only when the model's own name/description signals it; unknown and
 * custom models are never given invented performance claims.
 */
export function profileLangyModel({
  modelId,
  metadata,
  isCustom = false,
}: {
  modelId: string;
  metadata?: LangyModelProfileSource;
  isCustom?: boolean;
}): LangyModelProfile {
  const description = metadata?.description ?? "";
  const modelName = modelId.split("/").slice(1).join("/");
  const isQuick =
    QUICK_NAME.test(modelName) || QUICK_DESCRIPTION.test(description);
  const isLongRunning =
    LONG_RUNNING.test(modelName.replaceAll("_", " ")) ||
    LONG_RUNNING.test(description);
  const hasReasoning = metadata?.reasoningConfig?.supported === true;
  const isMultimodal = Boolean(
    metadata?.supportsImageInput ||
    metadata?.supportsAudioInput ||
    metadata?.supportsImageOutput ||
    metadata?.supportsAudioOutput,
  );

  const group: LangyModelGroup = isCustom
    ? "custom"
    : isLongRunning
      ? "reasoning"
      : metadata?.supportsImageOutput || metadata?.supportsAudioOutput
        ? "multimodal"
        : isQuick
          ? "quick"
          : hasReasoning
            ? "reasoning"
            : "balanced";

  return { group, isQuick, isLongRunning, hasReasoning, isMultimodal };
}

import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import { Settings } from "react-feather";

import { ConfigModal } from "../../optimization_studio/components/properties/modals/ConfigModal";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { MIN_MAX_TOKENS, FALLBACK_MAX_TOKENS } from "~/utils/constants";
import { useModelLimits } from "~/hooks/useModelLimits";

export type LlmConfigModalValues = {
  model: string;
  temperature?: number;
  max_tokens?: number;
} & (
  | { max_tokens?: number; maxTokens?: never }
  | { maxTokens?: number; max_tokens?: never }
);

/**
 * Controlled LLM Config Modal
 *
 * Responsibilities:
 * - Display and edit LLM configuration (model, temperature, max tokens)
 * - Enforce GPT-5 constraints when switching TO GPT-5 (temperature=1)
 * - Support both snake_case and camelCase for backwards compatibility
 * - Normalize values to ensure consistency (defaults undefined maxTokens to MIN_MAX_TOKENS)
 * - Dynamically determine min/max token limits based on selected model
 *
 * Note: Form schema enforces minimum constraints as data integrity layer:
 * - All models: min 256 tokens, max based on model's capabilities
 *
 * @param open - Whether the modal is open
 * @param onClose - Callback when modal closes
 * @param values - Current LLM configuration values
 * @param onChange - Callback when values change
 */
/**
 * Ensures only one of maxTokens or max_tokens is set
 */
function normalizeMaxTokens(
  values: Record<string, unknown>,
  tokenValue: number,
): LlmConfigModalValues {
  const usesCamelCase = values.maxTokens !== undefined;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { maxTokens, max_tokens, ...rest } = values;

  if (usesCamelCase) {
    return { ...rest, maxTokens: tokenValue } as LlmConfigModalValues;
  } else {
    return { ...rest, max_tokens: tokenValue } as LlmConfigModalValues;
  }
}

export function LLMConfigModal({
  open,
  onClose,
  values,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  values: LlmConfigModalValues;
  onChange: (params: LlmConfigModalValues) => void;
}) {
  const maxTokens = values.maxTokens ?? values.max_tokens;
  const isGpt5 = values?.model?.includes("gpt-5");

  // Get model limits dynamically
  const { limits: modelLimits } = useModelLimits({ model: values.model });
  const maxTokenLimit =
    modelLimits?.maxOutputTokens ??
    modelLimits?.maxTokens ??
    FALLBACK_MAX_TOKENS;

  // Enforce constraints when model limits change (async)
  useEffect(() => {
    if (!modelLimits) return; // Wait for limits to load

    // Constrain max tokens to the range
    let constrainedMaxTokens = Math.max(maxTokens ?? 0, MIN_MAX_TOKENS);
    constrainedMaxTokens = Math.min(constrainedMaxTokens, maxTokenLimit);

    // Check if we need to enforce constraints
    const needsMaxTokenUpdate = constrainedMaxTokens !== maxTokens;
    const isGpt5 = values.model?.includes("gpt-5");
    const needsTempUpdate = isGpt5 && values.temperature !== 1;

    if (needsMaxTokenUpdate || needsTempUpdate) {
      const updates: Partial<LlmConfigModalValues> = {};
      if (needsMaxTokenUpdate) {
        updates.maxTokens = constrainedMaxTokens;
      }
      if (needsTempUpdate) {
        updates.temperature = 1;
      }

      onChange(
        normalizeMaxTokens({ ...values, ...updates }, constrainedMaxTokens),
      );
    }
  }, [modelLimits, values, onChange, maxTokens, maxTokenLimit]);

  return (
    <ConfigModal open={open} onClose={onClose} title="LLM Config">
      <HorizontalFormControl
        label="Model"
        helper={"The LLM model to use"}
        inputWidth="55%"
      >
        <HStack width="full" gap={2}>
          <ModelSelector
            model={values?.model ?? ""}
            options={allModelOptions}
            onChange={(model) => onChange({ ...values, model })}
            mode="chat"
            size="full"
          />
          <Tooltip
            content="Configure available models"
            positioning={{ placement: "top" }}
            showArrow
          >
            <Link href="/settings/model-providers" target="_blank" asChild>
              <Button variant="ghost" size="sm">
                <Settings size={16} />
              </Button>
            </Link>
          </Tooltip>
        </HStack>
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Temperature"
        helper="Controls randomness in the output"
        inputWidth="55%"
      >
        <Input
          required
          value={values?.temperature}
          type="number"
          step={0.1}
          min={isGpt5 ? 1 : 0}
          max={isGpt5 ? 1 : 2}
          placeholder="1"
          onChange={(e) =>
            onChange({ ...values, temperature: Number(e.target.value) })
          }
        />
        {isGpt5 && (
          <WarningText>Temperature is fixed to 1 for GPT-5 models</WarningText>
        )}
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Max Tokens"
        helper={"Limit to avoid expensive outputs"}
        inputWidth="55%"
      >
        <VStack align="stretch" gap={0}>
          <Input
            required
            value={maxTokens}
            type="number"
            step={64}
            min={MIN_MAX_TOKENS}
            placeholder={MIN_MAX_TOKENS.toString()}
            max={maxTokenLimit}
            onChange={(e) =>
              onChange(normalizeMaxTokens(values, Number(e.target.value)))
            }
          />
          <Text fontSize="xs" color="gray.500" marginTop={1}>
            Min: {MIN_MAX_TOKENS.toLocaleString()} | Max:{" "}
            {maxTokenLimit.toLocaleString()}
          </Text>
        </VStack>
      </HorizontalFormControl>
    </ConfigModal>
  );
}

/**
 * WarningText
 * Responsibilities:
 * Display warning text with yellow styling
 *
 * TODO: Move to a separate file
 */
function WarningText({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize="xs"
      color="yellow.500"
      fontStyle="italic"
      marginTop={1}
      marginLeft={2}
    >
      {children}
    </Text>
  );
}

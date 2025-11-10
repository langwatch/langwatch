import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
import { Settings } from "react-feather";

import { ConfigModal } from "../../optimization_studio/components/properties/modals/ConfigModal";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS } from "~/utils/constants";

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
 * - Enforce GPT-5 constraints when switching TO GPT-5 (temperature=1, min maxTokens=128k)
 * - Support both snake_case and camelCase for backwards compatibility
 * - Normalize values to ensure consistency (defaults undefined maxTokens to MIN_MAX_TOKENS)
 *
 * Note: Form schema also enforces minimum constraints as data integrity layer:
 * - GPT-5: temperature=1, min 128k tokens
 * - Other models: min 256 tokens
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

  if (usesCamelCase) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { max_tokens, ...rest } = values;
    return { ...rest, maxTokens: tokenValue } as LlmConfigModalValues;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { maxTokens, ...rest } = values;
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

  /**
   * Intelligent value change handler
   *
   * Responsibilities:
   * - When switching TO GPT-5: Enforce temp=1 & min 128k tokens
   * - All changes: Normalize maxTokens format (snake_case vs camelCase) and default to MIN_MAX_TOKENS
   */
  const handleValueChange = useCallback(
    (updates: Partial<LlmConfigModalValues>) => {
      const newValues = { ...values, ...updates };
      const newMaxTokens = newValues.maxTokens ?? newValues.max_tokens;
      const newIsGpt5 = newValues.model?.includes("gpt-5");
      const wasGpt5 = values.model?.includes("gpt-5");
      const modelChanged =
        updates.model !== undefined && newValues.model !== values.model;

      // Switching TO GPT-5 - enforce constraints
      if (modelChanged && newIsGpt5 && !wasGpt5) {
        const enforcedMaxTokens = Math.max(
          newMaxTokens ?? MIN_MAX_TOKENS,
          DEFAULT_MAX_TOKENS,
        );
        onChange(
          normalizeMaxTokens(
            { ...newValues, temperature: 1 },
            enforcedMaxTokens,
          ),
        );
        return;
      }

      onChange(normalizeMaxTokens(newValues, newMaxTokens ?? MIN_MAX_TOKENS));
    },
    [values, onChange],
  );

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
            onChange={(model) => handleValueChange({ model })}
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
            handleValueChange({ temperature: Number(e.target.value) })
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
            min={isGpt5 ? DEFAULT_MAX_TOKENS : MIN_MAX_TOKENS}
            placeholder={
              isGpt5 ? DEFAULT_MAX_TOKENS.toString() : MIN_MAX_TOKENS.toString()
            }
            max={1048576}
            onChange={(e) => {
              const newValue = Number(e.target.value);
              handleValueChange(
                values.maxTokens !== undefined
                  ? { maxTokens: newValue }
                  : { max_tokens: newValue },
              );
            }}
          />
          {isGpt5 && (
            <WarningText>
              Max tokens must be at least {DEFAULT_MAX_TOKENS} for GPT-5 models
            </WarningText>
          )}
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

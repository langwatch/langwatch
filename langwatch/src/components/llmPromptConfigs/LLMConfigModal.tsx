import { Button, HStack, Input, Text, VStack, Field } from "@chakra-ui/react";
import { Settings } from "lucide-react";

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
 * - Support both snake_case and camelCase for backwards compatibility
 * - Dynamically determine min/max token limits based on selected model
 * - Display validation errors from form schema
 *
 * Note: Form schema enforces constraints as data integrity layer:
 * - All models: min 256 tokens, max based on model's capabilities
 * - GPT-5: temperature must be 1
 *
 * @param open - Whether the modal is open
 * @param onClose - Callback when modal closes
 * @param values - Current LLM configuration values
 * @param onChange - Callback when values change
 * @param errors - Validation errors from form schema
 */
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
  errors,
}: {
  open: boolean;
  onClose: () => void;
  values: LlmConfigModalValues;
  onChange: (params: LlmConfigModalValues) => void;
  errors?: {
    temperature?: { message?: string };
    maxTokens?: { message?: string };
  };
}) {
  const maxTokens = values.maxTokens ?? values.max_tokens;
  const isGpt5 = values?.model?.includes("gpt-5");

  // Get model limits dynamically for UI display
  const { limits: modelLimits } = useModelLimits({ model: values.model });
  const maxTokenLimit =
    modelLimits?.maxOutputTokens ??
    modelLimits?.maxTokens ??
    FALLBACK_MAX_TOKENS;

  return (
    // TODO: Issue #863 - Issues are hidden when the modal is closed
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
        helper="Controls randomness in the output"
        invalid={!!errors?.temperature}
        label="Temperature"
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
        {errors?.temperature?.message && (
          <Field.ErrorText margin={0} fontSize="13px">
            {errors?.temperature?.message?.toString()}
          </Field.ErrorText>
        )}
      </HorizontalFormControl>
      <HorizontalFormControl
        invalid={!!errors?.maxTokens}
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
          {errors?.maxTokens?.message && (
            <Field.ErrorText margin={0} fontSize="13px">
              {errors?.maxTokens?.message?.toString()}
            </Field.ErrorText>
          )}
        </VStack>
      </HorizontalFormControl>
    </ConfigModal>
  );
}

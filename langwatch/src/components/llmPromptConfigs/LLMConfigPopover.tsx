import {
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Settings, X } from "react-feather";
import { useModelLimits } from "~/hooks/useModelLimits";
import { FALLBACK_MAX_TOKENS, MIN_MAX_TOKENS } from "~/utils/constants";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Link } from "../ui/link";
import { Popover } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";

export type LLMConfigValues = {
  model: string;
  temperature?: number;
  max_tokens?: number;
} & (
  | { max_tokens?: number; maxTokens?: never }
  | { maxTokens?: number; max_tokens?: never }
);

/**
 * Ensures only one of maxTokens or max_tokens is set
 */
const normalizeMaxTokens = (
  values: Record<string, unknown>,
  tokenValue: number,
): LLMConfigValues => {
  const usesCamelCase = values.maxTokens !== undefined;

  const {
    maxTokens: _sunkMaxTokens,
    max_tokens: _sunkMaxTokens2,
    ...rest
  } = values;

  if (usesCamelCase) {
    return { ...rest, maxTokens: tokenValue } as LLMConfigValues;
  } else {
    return { ...rest, max_tokens: tokenValue } as LLMConfigValues;
  }
};

/**
 * LLM Config Popover Content
 *
 * Renders the popover content for LLM configuration.
 * Should be used inside a Popover.Root with a Popover.Trigger sibling.
 *
 * Features:
 * - Model selector
 * - Temperature control (disabled for GPT-5)
 * - Max tokens control with dynamic limits
 *
 * @param values - Current LLM configuration values
 * @param onChange - Callback when values change
 * @param errors - Validation errors from form schema
 */
export function LLMConfigPopover({
  values,
  onChange,
  errors,
}: {
  values: LLMConfigValues;
  onChange: (params: LLMConfigValues) => void;
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
    <Popover.Content minWidth="500px">
      <HStack
        width="full"
        paddingX={4}
        paddingY={2}
        paddingRight={1}
        borderBottomWidth="1px"
        borderColor="gray.200"
      >
        <Text fontSize="14px" fontWeight={500}>
          LLM Config
        </Text>
        <Spacer />
        <Popover.CloseTrigger asChild>
          <Button size="sm" variant="ghost">
            <X size={16} />
          </Button>
        </Popover.CloseTrigger>
      </HStack>
      <VStack paddingY={2} paddingX={4} width="full" align="start">
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
            disabled={isGpt5}
            placeholder="1"
            onChange={(e) =>
              onChange({ ...values, temperature: Number(e.target.value) })
            }
          />
          {isGpt5 && (
            <Text fontSize="xs" color="gray.500" marginTop={1}>
              Temperature is fixed to 1 for GPT-5 models
            </Text>
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
      </VStack>
    </Popover.Content>
  );
}

import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Settings } from "react-feather";

import { ConfigModal } from "../../optimization_studio/components/properties/modals/ConfigModal";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { DEFAULT_MAX_TOKENS } from "~/utils/constants";

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
 * Accepts both snake_case (optimization studio) and camelCase (prompt-configs)
 * for backwards dsl compatibility
 */
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
  // Normalize internally
  const maxTokens = values.maxTokens ?? values.max_tokens;
  const isGpt5 = values?.model?.includes("gpt-5");

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
            min={isGpt5 ? DEFAULT_MAX_TOKENS : 256}
            placeholder={isGpt5 ? DEFAULT_MAX_TOKENS.toString() : "256"}
            max={1048576}
            onChange={(e) => {
              const newValue = Number(e.target.value);
              // Return in same format as input, explicitly removing the other
              if (values.maxTokens !== undefined) {
                const { max_tokens: _, ...rest } = values;
                onChange({ ...rest, maxTokens: newValue });
              } else {
                const { maxTokens: _, ...rest } = values;
                onChange({ ...rest, max_tokens: newValue });
              }
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

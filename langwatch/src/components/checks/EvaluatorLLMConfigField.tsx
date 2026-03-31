import { Box, HStack } from "@chakra-ui/react";
import { useCallback, useMemo } from "react";
import { ChevronDown } from "react-feather";
import { useFormContext, useWatch } from "react-hook-form";
import { LLMConfigPopover } from "~/components/llmPromptConfigs/LLMConfigPopover";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import { toInternalKey } from "~/components/llmPromptConfigs/parameterConfig";
import { Popover } from "~/components/ui/popover";
import type { LLMConfig } from "~/optimization_studio/types/dsl";

/**
 * LLM config parameter keys that the popover can read/write.
 * Used to bridge react-hook-form fields with LLMConfigPopover's object API.
 */
export const LLM_CONFIG_KEYS = [
  "model",
  "max_tokens",
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "top_k",
  "min_p",
  "repetition_penalty",
  "reasoning",
  "verbosity",
] as const;

/**
 * Bridging component that connects react-hook-form's flat structure
 * with LLMConfigPopover's object-based API.
 *
 * Reads all LLM config parameters from form context, constructs an
 * LLMConfig object, and writes all changed parameters back on change.
 */
export const EvaluatorLLMConfigField = ({ prefix }: { prefix: string }) => {
  const { setValue, control } = useFormContext();

  // Watch all LLM config fields for changes
  const watchedValues = useWatch({
    control,
    name: LLM_CONFIG_KEYS.map((key) => `${prefix}.${key}`),
  }) as (string | number | undefined)[];

  // Construct LLMConfig object from watched values
  const llmConfig: LLMConfig = useMemo(() => {
    const config: Record<string, string | number | undefined> = {};
    LLM_CONFIG_KEYS.forEach((key, index) => {
      if (watchedValues[index] !== undefined) {
        config[key] = watchedValues[index];
      }
    });
    config.model = (config.model as string) ?? "";
    return config as LLMConfig;
  }, [watchedValues]);

  // Handle changes from LLMConfigPopover — write all keys back to form
  const handleChange = useCallback(
    (newConfig: LLMConfig) => {
      for (const [key, value] of Object.entries(newConfig)) {
        const formKey = toInternalKey(key);
        if (value !== undefined) {
          setValue(`${prefix}.${formKey}`, value, { shouldDirty: true });
        }
      }
    },
    [prefix, setValue],
  );

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        <HStack
          width="full"
          paddingY={2}
          paddingX={3}
          borderRadius="md"
          border="1px solid"
          borderColor="border"
          cursor="pointer"
          _hover={{ bg: "gray.50" }}
          transition="background 0.15s"
          justify="space-between"
        >
          <LLMModelDisplay model={llmConfig.model} />
          <Box color="fg.muted">
            <ChevronDown size={16} />
          </Box>
        </HStack>
      </Popover.Trigger>
      <LLMConfigPopover values={llmConfig} onChange={handleChange} />
    </Popover.Root>
  );
};

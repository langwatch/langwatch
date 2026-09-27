import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Popover } from "@langwatch/design-system/popover";
import { allModelOptions } from "@langwatch/model-provider-browser-kit";
import {
  getParameterConfigWithModelOverrides,
  getParamValue,
  type LLMConfigValues,
  ParameterRow,
} from "@langwatch/prompt-browser-kit";

import { ModelSelector } from "../../../behavior/lent-model-provider.tsx";
import { useLlmConfigPopoverState } from "../../../behavior/use-llm-config-popover-state.ts";
import { type Output, OutputsSection, type OutputType } from "../outputs/outputs-section.tsx";

// Default output when structured outputs is disabled
const DEFAULT_OUTPUT: Output = { identifier: "output", type: "str" };

// ============================================================================
// Component Props
// ============================================================================

type LLMConfigPopoverProps = {
  values: LLMConfigValues;
  onChange: (params: LLMConfigValues) => void;
  errors?: {
    temperature?: { message?: string };
    maxTokens?: { message?: string };
  };
  /** Outputs configuration (for structured outputs) */
  outputs?: Output[];
  /** Callback when outputs change */
  onOutputsChange?: (outputs: Output[]) => void;
  /** Whether to show the structured outputs section */
  showStructuredOutputs?: boolean;
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * LLM Config Popover Content
 */
export function LLMConfigPopover({
  values,
  onChange,
  errors,
  outputs,
  onOutputsChange,
  showStructuredOutputs = false,
}: LLMConfigPopoverProps) {
  const { project } = useOrganizationTeamProject();
  const {
    currentModelMetadata,
    reasoningConfig,
    displayParameters,
    maxTokenLimit,
    openParameter,
    setOpenParameter,
    handleParamChange,
    handleModelChange,
    isStructuredOutputsEnabled,
    handleStructuredOutputsToggle,
  } = useLlmConfigPopoverState({
    projectId: project?.id,
    values,
    onChange,
    outputs,
    onOutputsChange,
    defaultOutput: DEFAULT_OUTPUT,
  });

  return (
    <Popover.Content minWidth="260px" maxWidth="100%">
      <VStack paddingY={2} paddingX={2} width="full" align="start" gap={3}>
        {/* Model Selector */}
        <Box width="full">
          <Text
            fontSize="13px"
            fontWeight="medium"
            color="fg.subtle"
            paddingLeft={2}
            paddingBottom={1}
          >
            Model
          </Text>
          <ModelSelector
            model={values?.model ?? ""}
            options={allModelOptions}
            onChange={handleModelChange}
            mode="chat"
            size="full"
            showConfigureAction={true}
          />
        </Box>

        {/* Dynamic Parameters */}
        <VStack width="full" gap={1} align="stretch">
          <Text
            fontSize="13px"
            fontWeight="medium"
            color="fg.subtle"
            paddingLeft={2}
            paddingBottom={1}
          >
            Parameters
          </Text>
          {displayParameters.map((paramName) => {
            // Get effective config (with dynamic options for reasoning)
            const config = getParameterConfigWithModelOverrides(
              paramName,
              reasoningConfig ?? undefined,
            );
            if (!config) return null;

            const value = getParamValue(values, paramName);

            // Get provider-level parameter constraints
            const paramConstraints = currentModelMetadata?.parameterConstraints?.[paramName];

            // Determine effective max override:
            // - For max_tokens: use model's maxCompletionTokens
            // - For other params: use provider constraints if available
            const maxOverride = paramName === "max_tokens" ? maxTokenLimit : paramConstraints?.max;

            // Determine effective min override from provider constraints
            const minOverride = paramConstraints?.min;

            return (
              <ParameterRow
                key={paramName}
                name={paramName}
                config={config}
                value={value}
                onChange={(newValue) => handleParamChange(paramName, newValue)}
                maxOverride={maxOverride}
                minOverride={minOverride}
                isOpen={openParameter === paramName}
                onOpenChange={(open) => setOpenParameter(open ? paramName : null)}
              />
            );
          })}

          {/* Show model info if no supported params */}
          {displayParameters.length === 0 && (
            <Text fontSize="xs" color="fg.muted">
              No configurable parameters for this model
            </Text>
          )}
        </VStack>

        {/* Error messages */}
        {errors?.temperature?.message && (
          <Text color="red.500" fontSize="12px">
            {errors.temperature.message}
          </Text>
        )}
        {errors?.maxTokens?.message && (
          <Text color="red.500" fontSize="12px">
            {errors.maxTokens.message}
          </Text>
        )}

        {/* Structured Outputs Section */}
        {showStructuredOutputs && onOutputsChange && (
          <VStack width="full" gap={2}>
            <HStack
              width="full"
              justify="space-between"
              paddingX={2}
              paddingBottom={isStructuredOutputsEnabled ? 0 : 2}
            >
              <HStack
                width="full"
                align="start"
                gap={0}
                justify="space-between"
                cursor="pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => handleStructuredOutputsToggle(!isStructuredOutputsEnabled)}
              >
                <Text fontSize="13px" fontWeight="medium" color="fg.subtle">
                  Structured Outputs
                </Text>
                <Box
                  as="button"
                  role="switch"
                  aria-checked={isStructuredOutputsEnabled}
                  data-testid="structured-outputs-switch"
                  data-state={isStructuredOutputsEnabled ? "checked" : "unchecked"}
                  display="flex"
                  alignItems="center"
                  justifyContent={isStructuredOutputsEnabled ? "flex-end" : "flex-start"}
                  width="34px"
                  height="20px"
                  borderRadius="full"
                  bg={isStructuredOutputsEnabled ? "blue.500" : "gray.300"}
                  padding="2px"
                  cursor="pointer"
                  transition="background 0.2s"
                  flexShrink={0}
                >
                  <Box
                    width="16px"
                    height="16px"
                    borderRadius="full"
                    bg="white"
                    boxShadow="sm"
                    transition="all 0.2s"
                  />
                </Box>
              </HStack>
            </HStack>

            {isStructuredOutputsEnabled && outputs && (
              <Box
                width="full"
                padding={2}
                paddingLeft={3}
                border="1px solid"
                borderColor="border"
                borderRadius="lg"
                background="bg"
              >
                <OutputsSection outputs={outputs} onChange={onOutputsChange} title="Outputs" />
              </Box>
            )}
          </VStack>
        )}
      </VStack>
    </Popover.Content>
  );
}

export type { Output, OutputType };

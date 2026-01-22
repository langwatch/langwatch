import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import {
  type Output,
  OutputsSection,
  type OutputType,
} from "../outputs/OutputsSection";
import { Popover } from "../ui/popover";
import { Switch } from "../ui/switch";

import { ParameterRow } from "./ParameterRow";
import {
  DEFAULT_SUPPORTED_PARAMETERS,
  getDisplayParameters,
  getParameterConfigWithModelOverrides,
  toFormKey,
} from "./parameterConfig";
import type { LLMConfigValues } from "./types";
import { getParamValue } from "./utils/paramValueUtils";
import {
  buildModelChangeValues,
  getMaxTokenLimit,
  normalizeMaxTokens,
} from "./utils/tokenUtils";

// Re-export types for backward compatibility
export type { LLMConfigValues } from "./types";

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
 *
 * Renders the popover content for LLM configuration with dynamic parameters
 * based on the selected model's capabilities.
 *
 * Features:
 * - Model selector with provider icons
 * - Dynamic parameter display based on model's supportedParameters
 * - Max tokens slider with model-specific limits
 * - Reasoning parameters (reasoning, verbosity) for reasoning models
 * - Traditional parameters (temperature, top_p, penalties) for other models
 * - Structured outputs toggle and configuration
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

  // State for tracking which parameter popover is open
  const [openParameter, setOpenParameter] = useState<string | null>(null);
  const { modelMetadata } = useModelProvidersSettings({
    projectId: project?.id,
  });

  // Get metadata for the currently selected model
  const currentModelMetadata = values.model
    ? modelMetadata?.[values.model]
    : undefined;

  // Get reasoning config for the model
  const reasoningConfig = currentModelMetadata?.reasoningConfig;

  // Determine which parameters to display
  // Uses unified 'reasoning' parameter - no provider-specific substitution needed
  const displayParameters = useMemo(() => {
    const supportedParams =
      currentModelMetadata?.supportedParameters ?? DEFAULT_SUPPORTED_PARAMETERS;
    return getDisplayParameters(supportedParams);
  }, [currentModelMetadata?.supportedParameters]);

  // Get max token limit for the model
  const maxTokenLimit = useMemo(() => {
    return getMaxTokenLimit(currentModelMetadata);
  }, [currentModelMetadata]);

  // Handle parameter change - outputs camelCase keys for form compatibility
  const handleParamChange = (paramName: string, value: number | string) => {
    const formKey = toFormKey(paramName);

    if (paramName === "max_tokens") {
      onChange(normalizeMaxTokens(values, value as number));
    } else {
      // Remove BOTH potential keys (snake_case and camelCase) to avoid duplicates
      // This ensures the new value replaces the old regardless of key format
      const {
        [paramName]: _snake,
        [formKey]: _camel,
        ...rest
      } = values as Record<string, unknown>;
      onChange({ ...rest, [formKey]: value } as LLMConfigValues);
    }
  };

  // Structured outputs state
  const hasNonDefaultOutputs =
    outputs &&
    (outputs.length !== 1 ||
      outputs[0]?.identifier !== "output" ||
      outputs[0]?.type !== "str");

  const [isStructuredOutputsEnabled, setIsStructuredOutputsEnabled] = useState(
    hasNonDefaultOutputs ?? false,
  );

  // Track user-initiated toggle to prevent race condition with sync effect
  const userInitiatedToggleRef = useRef(false);

  // Sync state when outputs change externally (e.g., loading a prompt)
  useEffect(() => {
    // Skip sync if user just toggled - let the outputs update first
    if (userInitiatedToggleRef.current) {
      userInitiatedToggleRef.current = false;
      return;
    }
    if (hasNonDefaultOutputs && !isStructuredOutputsEnabled) {
      setIsStructuredOutputsEnabled(true);
    }
  }, [hasNonDefaultOutputs, isStructuredOutputsEnabled]);

  const handleStructuredOutputsToggle = (checked: boolean) => {
    if (!onOutputsChange) return;

    userInitiatedToggleRef.current = true;
    setIsStructuredOutputsEnabled(checked);
    if (!checked) {
      onOutputsChange([DEFAULT_OUTPUT]);
    }
  };

  return (
    <Popover.Content minWidth="260px" maxWidth="100%" zIndex={1401}>
      <VStack paddingY={3} paddingX={4} width="full" align="start" gap={3}>
        {/* Model Selector */}
        <Box width="full">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted" marginBottom={1}>
            Model
          </Text>
          <ModelSelector
            model={values?.model ?? ""}
            options={allModelOptions}
            onChange={(model) => {
              const newModelMetadata = modelMetadata?.[model];
              onChange(buildModelChangeValues(model, undefined, newModelMetadata));
            }}
            mode="chat"
            size="full"
            showConfigureAction={true}
          />
        </Box>

        {/* Dynamic Parameters */}
        <VStack width="full" gap={1} align="stretch">
          {displayParameters.map((paramName) => {
            // Get effective config (with dynamic options for reasoning)
            const config = getParameterConfigWithModelOverrides(
              paramName,
              reasoningConfig ?? undefined,
            );
            if (!config) return null;

            const value = getParamValue(values, paramName);

            return (
              <ParameterRow
                key={paramName}
                name={paramName}
                config={config}
                value={value}
                onChange={(newValue) => handleParamChange(paramName, newValue)}
                maxOverride={
                  paramName === "max_tokens" ? maxTokenLimit : undefined
                }
                isOpen={openParameter === paramName}
                onOpenChange={(open) =>
                  setOpenParameter(open ? paramName : null)
                }
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
          <>
            <HStack width="full" justify="space-between" paddingTop={2}>
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                  Structured Outputs
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Define custom output fields and types
                </Text>
              </VStack>
              <Switch
                size="sm"
                data-testid="structured-outputs-switch"
                checked={isStructuredOutputsEnabled}
                onCheckedChange={({ checked }) =>
                  handleStructuredOutputsToggle(checked)
                }
              />
            </HStack>

            {isStructuredOutputsEnabled && outputs && (
              <Box width="full">
                <OutputsSection
                  outputs={outputs}
                  onChange={onOutputsChange}
                  title="Outputs"
                />
              </Box>
            )}
          </>
        )}

      </VStack>
    </Popover.Content>
  );
}

export type { Output, OutputType };

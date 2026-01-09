import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState, useEffect, useMemo, useRef } from "react";
import { Settings, X } from "lucide-react";

import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { FALLBACK_MAX_TOKENS, MIN_MAX_TOKENS } from "../../utils/constants";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import {
  type Output,
  OutputsSection,
  type OutputType,
} from "../outputs/OutputsSection";
import { Link } from "../ui/link";
import { Popover } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";

import { ParameterField } from "./ParameterField";
import {
  getDisplayParameters,
  getEffectiveParameterConfig,
  getParameterConfig,
  DEFAULT_SUPPORTED_PARAMETERS,
} from "./parameterConfig";

// ============================================================================
// Types
// ============================================================================

export type LLMConfigValues = {
  model: string;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  reasoning?: string;
  verbosity?: string;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
} & (
  | { max_tokens?: number; maxTokens?: never }
  | { maxTokens?: number; max_tokens?: never }
);

// Default output when structured outputs is disabled
const DEFAULT_OUTPUT: Output = { identifier: "output", type: "str" };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensures only one of maxTokens or max_tokens is set
 */
const normalizeMaxTokens = (
  values: Record<string, unknown>,
  tokenValue: number
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
 * Get the parameter value from the config values
 */
function getParamValue(
  values: LLMConfigValues,
  paramName: string
): number | string | undefined {
  if (paramName === "max_tokens") {
    return values.maxTokens ?? values.max_tokens;
  }
  return (values as Record<string, unknown>)[paramName] as
    | number
    | string
    | undefined;
}

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
 * - Reasoning parameters (effort, verbosity) for reasoning models
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
  const { modelMetadata } = useModelProvidersSettings({
    projectId: project?.id,
  });

  // Get metadata for the currently selected model
  const currentModelMetadata = values.model
    ? modelMetadata?.[values.model]
    : undefined;

  // Determine which parameters to display
  const displayParameters = useMemo(() => {
    const supportedParams =
      currentModelMetadata?.supportedParameters ?? DEFAULT_SUPPORTED_PARAMETERS;
    return getDisplayParameters(supportedParams);
  }, [currentModelMetadata?.supportedParameters]);

  // Get max token limit for the model
  const maxTokenLimit = useMemo(() => {
    return (
      currentModelMetadata?.maxCompletionTokens ??
      currentModelMetadata?.contextLength ??
      FALLBACK_MAX_TOKENS
    );
  }, [currentModelMetadata]);

  // Get reasoning config for the model
  const reasoningConfig = currentModelMetadata?.reasoningConfig;

  // Handle parameter change
  const handleParamChange = (paramName: string, value: number | string) => {
    if (paramName === "max_tokens") {
      onChange(normalizeMaxTokens(values, value as number));
    } else {
      onChange({ ...values, [paramName]: value });
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
    <Popover.Content minWidth="420px" maxWidth="480px" zIndex={1401}>
      {/* Header */}
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
          <Button size="xs" variant="ghost">
            <X size={14} />
          </Button>
        </Popover.CloseTrigger>
      </HStack>

      {/* Content */}
      <VStack paddingY={3} paddingX={4} width="full" align="start" gap={3}>
        {/* Model Selector */}
        <HStack width="full" gap={2}>
          <Box flex={1}>
            <Text fontSize="xs" color="gray.600" marginBottom={1}>
              Model
            </Text>
            <ModelSelector
              model={values?.model ?? ""}
              options={allModelOptions}
              onChange={(model) => onChange({ ...values, model })}
              mode="chat"
              size="full"
            />
          </Box>
          <Box paddingTop={5}>
            <Tooltip
              content="Configure available models"
              positioning={{ placement: "top" }}
              showArrow
            >
              <Link href="/settings/model-providers" target="_blank" asChild>
                <Button variant="ghost" size="xs">
                  <Settings size={14} />
                </Button>
              </Link>
            </Tooltip>
          </Box>
        </HStack>

        {/* Dynamic Parameters */}
        <VStack width="full" gap={3} align="stretch">
          {displayParameters.map((paramName) => {
            // Get effective config (with dynamic options for reasoning)
            const config = getEffectiveParameterConfig(
              paramName,
              reasoningConfig ?? undefined
            );
            if (!config) return null;

            const value = getParamValue(values, paramName);

            return (
              <ParameterField
                key={paramName}
                name={paramName}
                config={config}
                value={value}
                onChange={(newValue) => handleParamChange(paramName, newValue)}
                maxOverride={
                  paramName === "max_tokens" ? maxTokenLimit : undefined
                }
              />
            );
          })}

          {/* Show model info if no supported params */}
          {displayParameters.length === 0 && (
            <Text fontSize="xs" color="gray.500">
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
            <HorizontalFormControl
              label="Structured Outputs"
              helper="Define custom output fields and types"
              inputWidth="10%"
            >
              <HStack width="full" justify="flex-end">
                <Switch
                  data-testid="structured-outputs-switch"
                  checked={isStructuredOutputsEnabled}
                  onCheckedChange={({ checked }) =>
                    handleStructuredOutputsToggle(checked)
                  }
                />
              </HStack>
            </HorizontalFormControl>

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

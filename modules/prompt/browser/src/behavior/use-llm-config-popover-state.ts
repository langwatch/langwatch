import {
  buildModelChangeValues,
  DEFAULT_SUPPORTED_PARAMETERS,
  getDisplayParameters,
  getMaxTokenLimit,
  getParamValue,
  type LLMConfigValues,
  normalizeMaxTokens,
  toFormKey,
} from "@langwatch/prompt-browser-kit";
import { useEffect, useMemo, useRef, useState } from "react";

import { clampMaxTokens } from "../model/clamp-max-tokens.ts";
import { useModelProvidersSettings } from "./use-model-providers-settings.ts";

/** The one output a prompt has when structured outputs are off. */
type DefaultOutput = { identifier: string; type: string };

/** A value that replaces a parameter under its form key, whichever key it was stored under. */
function withParam({
  values,
  paramName,
  value,
}: {
  values: LLMConfigValues;
  paramName: string;
  value: number | string;
}): LLMConfigValues {
  if (paramName === "max_tokens") return normalizeMaxTokens(values, value as number);
  const formKey = toFormKey(paramName);
  const { [paramName]: _snake, [formKey]: _camel, ...rest } = values as Record<string, unknown>;
  return { ...rest, [formKey]: value } as LLMConfigValues;
}

/**
 * Clamps a saved maxTokens against the configured model ceiling: the configured
 * max is the source of truth, so a stale form value above it is corrected
 * rather than shown raw and persisted out of bounds.
 */
function useMaxTokensClamp({
  hasMetadata,
  maxTokenLimit,
  values,
  onChange,
}: {
  hasMetadata: boolean;
  maxTokenLimit: number | undefined;
  values: LLMConfigValues;
  onChange: (params: LLMConfigValues) => void;
}) {
  useEffect(() => {
    if (!hasMetadata) return;
    const currentMaxTokens = getParamValue(values, "max_tokens");
    if (typeof currentMaxTokens !== "number") return;
    const clamped = clampMaxTokens(currentMaxTokens, maxTokenLimit);
    if (clamped !== undefined && clamped !== currentMaxTokens) {
      onChange(normalizeMaxTokens(values, clamped));
    }
  }, [hasMetadata, maxTokenLimit, values, onChange]);
}

/** Whether outputs are anything but the single default string output. */
const isNonDefaultOutputs = (outputs: readonly DefaultOutput[] | undefined): boolean =>
  !!outputs &&
  (outputs.length !== 1 || outputs[0]?.identifier !== "output" || outputs[0]?.type !== "str");

/** The structured-outputs switch, following outputs loaded from outside. */
function useStructuredOutputsToggle<Output extends DefaultOutput>({
  outputs,
  onOutputsChange,
  defaultOutput,
}: {
  outputs: Output[] | undefined;
  onOutputsChange: ((outputs: Output[]) => void) | undefined;
  defaultOutput: Output;
}) {
  const hasNonDefaultOutputs = isNonDefaultOutputs(outputs);
  const [isEnabled, setIsEnabled] = useState(hasNonDefaultOutputs);

  // A user toggle skips one sync, so the outputs update lands first.
  const userInitiatedToggleRef = useRef(false);

  useEffect(() => {
    if (userInitiatedToggleRef.current) {
      userInitiatedToggleRef.current = false;
      return;
    }
    if (hasNonDefaultOutputs && !isEnabled) setIsEnabled(true);
  }, [hasNonDefaultOutputs, isEnabled]);

  const toggle = (checked: boolean) => {
    // Nested click handlers can call twice with the same value.
    if (!onOutputsChange || checked === isEnabled) return;
    userInitiatedToggleRef.current = true;
    setIsEnabled(checked);
    if (!checked) onOutputsChange([defaultOutput]);
  };

  return { isEnabled, toggle };
}

/** Everything the LLM config popover derives from the model and its values. */
export function useLlmConfigPopoverState<Output extends DefaultOutput>({
  projectId,
  values,
  onChange,
  outputs,
  onOutputsChange,
  defaultOutput,
}: {
  projectId: string | undefined;
  values: LLMConfigValues;
  onChange: (params: LLMConfigValues) => void;
  outputs: Output[] | undefined;
  onOutputsChange: ((outputs: Output[]) => void) | undefined;
  defaultOutput: Output;
}) {
  const [openParameter, setOpenParameter] = useState<string | null>(null);
  const { modelMetadata } = useModelProvidersSettings({ projectId });

  const currentModelMetadata = values.model ? modelMetadata?.[values.model] : undefined;

  // The unified 'reasoning' parameter: no provider-specific substitution.
  const displayParameters = useMemo(
    () =>
      getDisplayParameters(
        currentModelMetadata?.supportedParameters ?? DEFAULT_SUPPORTED_PARAMETERS,
      ),
    [currentModelMetadata?.supportedParameters],
  );

  const maxTokenLimit = useMemo(
    () => getMaxTokenLimit(currentModelMetadata),
    [currentModelMetadata],
  );

  useMaxTokensClamp({ hasMetadata: !!currentModelMetadata, maxTokenLimit, values, onChange });

  const structuredOutputs = useStructuredOutputsToggle({ outputs, onOutputsChange, defaultOutput });

  return {
    currentModelMetadata,
    reasoningConfig: currentModelMetadata?.reasoningConfig,
    displayParameters,
    maxTokenLimit,
    openParameter,
    setOpenParameter,
    handleParamChange: (paramName: string, value: number | string) =>
      onChange(withParam({ values, paramName, value })),
    handleModelChange: (model: string) =>
      onChange(
        buildModelChangeValues(
          model,
          undefined,
          modelMetadata?.[model],
          values,
          currentModelMetadata,
        ),
      ),
    isStructuredOutputsEnabled: structuredOutputs.isEnabled,
    handleStructuredOutputsToggle: structuredOutputs.toggle,
  };
}

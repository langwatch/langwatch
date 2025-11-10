import { zodResolver } from "@hookform/resolvers/zod";
import isEqual from "lodash-es/isEqual";
import merge from "lodash-es/merge";
import { useEffect, useMemo } from "react";
import { useForm, type DeepPartial } from "react-hook-form";

import { formSchema, type PromptConfigFormValues } from "~/prompt-configs";

import { inputsAndOutputsToDemostrationColumns } from "../utils/llmPromptConfigUtils";

interface UsePromptConfigFormProps {
  configId?: string;
  initialConfigValues?: DeepPartial<PromptConfigFormValues>;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

let disableOnChange = false;
let disableNodeSync = false;
let disableFormSyncTimeout: NodeJS.Timeout | null = null;

/**
 * Attempts to salvage valid parts of corrupted config values.
 * 
 * Tries parsing the full object first. If that fails, attempts to parse
 * individual top-level fields (handle, scope, version) and keeps what's valid.
 * Falls back to schema defaults for invalid fields.
 * 
 * @param values - Potentially corrupted config values
 * @returns Merged object with valid parts preserved and defaults for invalid parts
 */
function salvageValidConfigValues(
  values: DeepPartial<PromptConfigFormValues>,
): PromptConfigFormValues {
  // Start with schema defaults
  const defaults = formSchema.parse({});
  
  const salvaged: DeepPartial<PromptConfigFormValues> = {};
  
  // Try to salvage top-level fields
  if (values.configId !== undefined) {
    salvaged.configId = values.configId;
  }
  
  if (values.handle !== undefined) {
    salvaged.handle = values.handle;
  }
  
  if (values.scope !== undefined) {
    const scopeResult = formSchema.shape.scope.safeParse(values.scope);
    if (scopeResult.success) {
      salvaged.scope = scopeResult.data;
    }
  }
  
  if (values.versionMetadata !== undefined) {
    salvaged.versionMetadata = values.versionMetadata;
  }
  
  // Try to salvage version.configData fields
  if (values.version?.configData) {
    const configData = values.version.configData;
    const salvagedConfigData: DeepPartial<PromptConfigFormValues["version"]["configData"]> = {};
    
    if (configData.prompt !== undefined) {
      salvagedConfigData.prompt = configData.prompt;
    }
    
    if (configData.messages !== undefined) {
      const messagesResult = formSchema.shape.version.shape.configData.shape.messages.safeParse(configData.messages);
      if (messagesResult.success) {
        salvagedConfigData.messages = messagesResult.data;
      }
    }
    
    if (configData.inputs !== undefined) {
      const inputsResult = formSchema.shape.version.shape.configData.shape.inputs.safeParse(configData.inputs);
      if (inputsResult.success) {
        salvagedConfigData.inputs = inputsResult.data;
      }
    }
    
    if (configData.outputs !== undefined) {
      const outputsResult = formSchema.shape.version.shape.configData.shape.outputs.safeParse(configData.outputs);
      if (outputsResult.success) {
        salvagedConfigData.outputs = outputsResult.data;
      }
    }
    
    if (configData.llm !== undefined) {
      const llmResult = formSchema.shape.version.shape.configData.shape.llm.safeParse(configData.llm);
      if (llmResult.success) {
        salvagedConfigData.llm = llmResult.data;
      }
    }
    
    if (configData.demonstrations !== undefined) {
      salvagedConfigData.demonstrations = configData.demonstrations;
    }
    
    if (configData.promptingTechnique !== undefined) {
      salvagedConfigData.promptingTechnique = configData.promptingTechnique;
    }
    
    if (configData.responseFormat !== undefined) {
      salvagedConfigData.responseFormat = configData.responseFormat;
    }
    
    salvaged.version = { configData: salvagedConfigData };
  }
  
  // Merge salvaged values with defaults (salvaged values take precedence)
  return merge({}, defaults, salvaged);
}

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues = {},
}: UsePromptConfigFormProps) => {
  /**
   * Parse initial values once with schema defaults applied.
   * Memoized to avoid re-parsing on every render.
   * Uses safeParse to salvage valid parts of corrupted data instead of throwing.
   */
  const parsedInitialValues = useMemo(() => {
    const result = formSchema.safeParse(initialConfigValues);

    if (!result.success) {
      console.warn(
        "Failed to parse initial config values, salvaging valid parts:",
        result.error,
      );
      // Attempt to salvage valid parts and merge with defaults
      return salvageValidConfigValues(initialConfigValues);
    }

    return result.data;
  }, [initialConfigValues]);

  const methods = useForm<PromptConfigFormValues>({
    /**
     * Use parsed values with defaults applied
     * @see https://react-hook-form.com/docs/useform#defaultValues
     */
    defaultValues: parsedInitialValues,
    resolver: (data, ...args) => {
      return zodResolver(formSchema)(data, ...args);
    },
  });

  const formData = methods.watch();
  const messages = methods.watch("version.configData.messages");
  // Messages should always be defined, but we're being defensive here.
  const systemMessage = messages?.find(({ role }) => role === "system")
    ?.content;

  /**
   * In the case that we're using system messages,
   * make sure to keep the prompt synced
   */
  useEffect(() => {
    if (systemMessage) {
      const currentPrompt = methods.getValues("version.configData.prompt");
      // Only sync when value differs; do not mark dirty for this derived update
      if (currentPrompt !== systemMessage) {
        methods.setValue("version.configData.prompt", systemMessage, {
          shouldDirty: false,
        });
      }
    }
  }, [systemMessage, methods]);

  // Handle syncing the inputs/outputs with the demonstrations columns
  useEffect(() => {
    const inputs = formData.version?.configData.inputs ?? [];
    const outputs = formData.version?.configData.outputs ?? [];
    const newColumns = inputsAndOutputsToDemostrationColumns(inputs, outputs);
    const currentColumns =
      formData.version?.configData.demonstrations?.inline?.columnTypes ?? [];
    const currentRecords =
      formData.version?.configData.demonstrations?.inline?.records ?? {};

    if (!isEqual(newColumns, currentColumns)) {
      methods.setValue(
        "version.configData.demonstrations.inline.columnTypes",
        newColumns,
      );
      methods.setValue(
        "version.configData.demonstrations.inline.records",
        currentRecords,
      );
    }
  }, [formData, methods]);

  // Provides forward sync of parent component to form values
  useEffect(() => {
    if (disableNodeSync) return;
    disableOnChange = true;
    // Use parsed values to ensure defaults are applied
    for (const [key, value] of Object.entries(
      parsedInitialValues?.version?.configData ?? {},
    )) {
      const currentValue = methods.getValues(
        `version.configData.${key}` as any,
      );
      if (!isEqual(currentValue, value)) {
        methods.setValue(`version.configData.${key}` as any, value as any);
      }
    }
    setTimeout(() => {
      disableOnChange = false;
    }, 1);
  }, [parsedInitialValues, methods]);

  // Provides reverse sync of form values to the parent component
  useEffect(() => {
    if (disableOnChange) return;
    disableNodeSync = true;
    onChange?.(formData);
    if (disableFormSyncTimeout) {
      clearTimeout(disableFormSyncTimeout);
    }
    disableFormSyncTimeout = setTimeout(() => {
      disableNodeSync = false;
    }, 1);
  }, [formData, onChange]);

  /**
   * Force temperature to be 1 when the model includes "gpt-5"
   */
  useEffect(() => {
    if (formData.version?.configData.llm.model?.includes("gpt-5")) {
      methods.setValue("version.configData.llm.temperature", 1);
    }
  }, [formData.version?.configData.llm.model, methods]);

  return {
    methods,
    configId,
  };
};

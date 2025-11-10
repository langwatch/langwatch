import { zodResolver } from "@hookform/resolvers/zod";
import isEqual from "lodash-es/isEqual";
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

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues = {},
}: UsePromptConfigFormProps) => {
  /**
   * Parse initial values once with schema defaults applied.
   * Memoized to avoid re-parsing on every render.
   * Uses safeParse to salvage corrupted data instead of throwing.
   */
  const parsedInitialValues = useMemo(() => {
    const result = formSchema.safeParse(initialConfigValues);
    
    if (!result.success) {
      console.warn("Failed to parse initial config values, using defaults:", result.error);
      // Return schema defaults by parsing empty object
      return formSchema.parse({});
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

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm, type DeepPartial } from "react-hook-form";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { inputsAndOutputsToDemostrationColumns } from "../llmPromptConfigUtils";
import isEqual from "lodash-es/isEqual";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const formSchema = promptConfigSchema.extend({
  version: z.object({
    configData: z.object({
      prompt: latestConfigVersionSchema.shape.configData.shape.prompt,
      messages: latestConfigVersionSchema.shape.configData.shape.messages,
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs,
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      llm: z.object({
        model: latestConfigVersionSchema.shape.configData.shape.model,
        temperature:
          latestConfigVersionSchema.shape.configData.shape.temperature,
        max_tokens: latestConfigVersionSchema.shape.configData.shape.max_tokens,
        // Additional params attached to the LLM config
        litellm_params: z.record(z.string()).optional(),
      }),
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
      prompting_technique:
        latestConfigVersionSchema.shape.configData.shape.prompting_technique,
    }),
  }),
});

export type PromptConfigFormValues = z.infer<typeof formSchema>;

interface UsePromptConfigFormProps {
  configId: string;
  initialConfigValues?: DeepPartial<PromptConfigFormValues>;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

let disableOnChange = false;
let disableNodeSync = false;
let disableFormSyncTimeout: NodeJS.Timeout | null = null;

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues,
}: UsePromptConfigFormProps) => {
  const methods = useForm<PromptConfigFormValues>({
    /**
     * Don't pass undefined as defaultValue
     * @see https://react-hook-form.com/docs/useform#defaultValues
     */
    defaultValues: initialConfigValues ?? {},
    resolver: zodResolver(formSchema),
  });

  const formData = methods.watch();

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
        newColumns
      );
      methods.setValue(
        "version.configData.demonstrations.inline.records",
        currentRecords
      );
    }
  }, [formData, methods]);

  // Provides forward sync of parent component to form values
  useEffect(() => {
    if (disableNodeSync) return;
    disableOnChange = true;
    for (const [key, value] of Object.entries(
      initialConfigValues?.version?.configData ?? {}
    )) {
      const currentValue = methods.getValues(
        `version.configData.${key}` as any
      );
      if (!isEqual(currentValue, value)) {
        methods.setValue(`version.configData.${key}` as any, value as any);
      }
    }
    setTimeout(() => {
      disableOnChange = false;
    }, 1);
  }, [initialConfigValues]);

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

  return {
    methods,
    configId,
  };
};

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm, type DeepPartial } from "react-hook-form";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { inputsAndOutputsToDemostrationColumns } from "../llmPromptConfigUtils";
import isEqual from "lodash.isequal";

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
    }),
  }),
});

export type PromptConfigFormValues = z.infer<typeof formSchema>;

interface UsePromptConfigFormProps {
  configId: string;
  initialConfigValues?: DeepPartial<PromptConfigFormValues>;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues,
}: UsePromptConfigFormProps) => {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: initialConfigValues,
    resolver: zodResolver(formSchema),
  });

  const formData = methods.watch();

  // Handle syncing the inputs/outputs with the demonstrations columns
  useEffect(() => {
    const inputs = formData.version?.configData.inputs ?? [];
    const outputs = formData.version?.configData.outputs ?? [];
    const newColumns = inputsAndOutputsToDemostrationColumns(inputs, outputs);
    const currentColumns =
      formData.version?.configData.demonstrations.columns ?? [];

    if (!isEqual(newColumns, currentColumns)) {
      methods.setValue("version.configData.demonstrations.columns", newColumns);
    }
  }, [formData]);

  const disableOnChange = useRef(false);
  const disableNodeSync = useRef(false);

  // Provides forward sync of form values to the parent component
  useEffect(() => {
    setTimeout(() => {
      if (disableOnChange.current) return;
      disableNodeSync.current = true;
      onChange?.(formData);
      disableNodeSync.current = false;
    }, 0);
  }, [formData, onChange]);

  // Provides reverse sync of form values to the parent component
  useEffect(() => {
    if (disableNodeSync.current) return;
    disableOnChange.current = true;
    // TODO: add other fields that might get updated from the store into the form
    methods.setValue(
      "version.configData.inputs",
      (initialConfigValues?.version?.configData?.inputs as any) ?? []
    );
    setTimeout(() => {
      disableOnChange.current = false;
    }, 1);
  }, [initialConfigValues]);

  return {
    methods,
    configId,
  };
};

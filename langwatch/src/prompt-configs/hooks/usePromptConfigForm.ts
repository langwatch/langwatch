import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const formSchema = promptConfigSchema.extend({
  version: z.object({
    configData: z.object({
      prompt: latestConfigVersionSchema.shape.configData.shape.prompt,
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs,
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      llm: z.object({
        model: latestConfigVersionSchema.shape.configData.shape.model,
        temperature:
          latestConfigVersionSchema.shape.configData.shape.temperature,
        max_tokens: latestConfigVersionSchema.shape.configData.shape.max_tokens,
        litellm_params:
          latestConfigVersionSchema.shape.configData.shape.litellm_params,
      }),
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
    }),
  }),
});

export type PromptConfigFormValues = z.infer<typeof formSchema>;

interface UsePromptConfigFormProps {
  configId: string;
  initialConfigValues?: Partial<PromptConfigFormValues>;
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

  // Provides on change callback to the parent component
  useEffect(() => {
    onChange?.(formData);
  }, [formData, onChange]);

  return {
    methods,
    configId,
  };
};

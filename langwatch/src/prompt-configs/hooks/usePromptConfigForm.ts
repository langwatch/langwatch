import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  getLatestConfigVersionSchema,
  SchemaVersion,
} from "~/server/prompt-config/repositories/llm-config-version-schema";

import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const formSchema = promptConfigSchema.extend({
  version: z.object({
    configData: z.object({
      model: latestConfigVersionSchema.shape.configData.shape.model,
      prompt: latestConfigVersionSchema.shape.configData.shape.prompt,
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs,
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
    }),
  }),
});

export type PromptConfigFormValues = z.infer<typeof formSchema>;

interface UsePromptConfigFormProps {
  configId: string;
  currentName?: string;
  onSuccess?: () => void;
  initialConfigValues?: Partial<PromptConfigFormValues>;
  projectId: string;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

export const usePromptConfigForm = ({
  projectId,
  configId,
  currentName,
  onSuccess,
  onChange,
  initialConfigValues,
}: UsePromptConfigFormProps) => {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: initialConfigValues,
    resolver: zodResolver(formSchema),
  });

  const updateConfig = api.llmConfigs.updatePromptConfig.useMutation();
  const createVersion = api.llmConfigs.versions.create.useMutation();
  const formData = methods.watch();

  useEffect(() => {
    onChange?.(formData);
  }, [formData, onChange]);

  const handleSubmit = async (data: PromptConfigFormValues) => {
    if (!projectId) {
      toaster.create({
        title: "Error",
        description: "Project ID is required",
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      return;
    }

    // Only update name if it changed
    if (data.name !== currentName) {
      await updateConfig.mutateAsync({
        projectId,
        id: configId,
        name: data.name,
      });
    }

    await createVersion.mutateAsync({
      projectId,
      configId,
      configData: data.version.configData,
      schemaVersion: SchemaVersion.V1_0,
      commitMessage: data.version.commitMessage,
    });

    onSuccess?.();
  };

  return {
    methods,
    handleSubmit: () => {
      void methods.handleSubmit(handleSubmit, (error) => {
        console.error("handleSubmit error", error);
      })();
    },
    isSubmitting: createVersion.isLoading || updateConfig.isLoading,
    configId,
  };
};

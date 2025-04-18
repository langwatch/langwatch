import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  getLatestConfigVersionSchema,
  SchemaVersion,
} from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import { usePromptConfigVersionMutation } from "./usePromptConfigVersionMutation";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const formSchema = promptConfigSchema.extend({
  version: z.object({
    commitMessage: latestConfigVersionSchema.shape.commitMessage.min(1, {
      message: "Commit message is required",
    }),
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
}

function convertConfigToDefaultValues(
  config: LlmConfigWithLatestVersion
): PromptConfigFormValues & {
  version: PromptConfigFormValues["version"] & {
    commitMessage?: string;
  };
} {
  return {
    ...config,
    version: {
      ...config.latestVersion,
      commitMessage: "",
      configData: config.latestVersion
        .configData as PromptConfigFormValues["version"]["configData"],
    },
  };
}

export const usePromptConfigForm = ({
  configId,
  currentName,
  onSuccess,
}: UsePromptConfigFormProps) => {
  const { project } = useOrganizationTeamProject();
  const { data: config, refetch } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery(
      {
        id: configId,
        projectId: project?.id ?? "",
      },
      {
        enabled: !!project?.id && !!configId,
      }
    );

  const methods = useForm<PromptConfigFormValues>({
    defaultValues: config ? convertConfigToDefaultValues(config) : undefined,
    resolver: zodResolver(formSchema),
  });

  // Once we have the config, reset the form
  useEffect(() => {
    if (config) {
      methods.reset(convertConfigToDefaultValues(config));
    }
  }, [config, methods]);

  const updateConfig = api.llmConfigs.updatePromptConfig.useMutation();
  const createVersion = usePromptConfigVersionMutation();

  const handleSubmit = async (data: PromptConfigFormValues) => {
    if (!project?.id) {
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
        projectId: project.id,
        id: configId,
        name: data.name,
      });
    }

    await createVersion.mutateAsync({
      projectId: project.id,
      configId,
      configData: data.version.configData,
      schemaVersion: SchemaVersion.V1_0,
      commitMessage: data.version.commitMessage,
    });

    await refetch();

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
    isLoading: config === undefined,
  };
};

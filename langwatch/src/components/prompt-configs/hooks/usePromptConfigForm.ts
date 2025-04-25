import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import { usePromptConfigVersionMutation } from "./usePromptConfigVersionMutation";
import { api } from "~/utils/api";
import { useEffect } from "react";
import type { LlmPromptConfig, LlmPromptConfigVersion } from "@prisma/client";
import type { DatasetColumnType } from "~/server/datasets/types";
import { SchemaVersion } from "~/server/repositories/llm-config-version-schema";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const versionSchema = z.object({
  commitMessage: z.string().min(1, "Commit message is required"),
  prompt: z.string().default("You are a helpful assistant"),
  model: z.string().default("openai/gpt4-o-mini"),
  inputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    })
  ),
  outputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
    })
  ),
  demonstrations: z
    .object({
      columns: z
        .array(
          z.object({
            name: z.string(),
            type: z.custom<DatasetColumnType>(),
          })
        )
        .default([]),
      rows: z
        .array(
          z
            .object({
              id: z.string().min(1),
            })
            .catchall(z.any())
        )
        .default([]),
    })
    .default({ columns: [], rows: [] }),
});

const formSchema = promptConfigSchema.extend({
  version: versionSchema,
});

export type PromptConfigFormValues = z.infer<typeof formSchema>;

interface UsePromptConfigFormProps {
  configId: string;
  currentName?: string;
  onSuccess?: () => void;
}

function convertConfigToDefaultValues(
  config: LlmPromptConfig & { versions: LlmPromptConfigVersion[] }
): PromptConfigFormValues {
  return {
    ...config,
    version: {
      ...(config?.versions[0]?.configData as PromptConfigFormValues["version"]),
      commitMessage: "",
    },
  };
}

export const usePromptConfigForm = ({
  configId,
  currentName,
  onSuccess,
}: UsePromptConfigFormProps) => {
  const { project } = useOrganizationTeamProject();
  const { data: config, refetch } = api.llmConfigs.getPromptConfigById.useQuery(
    {
      id: configId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
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
  const createVersion = usePromptConfigVersionMutation({ configId, onSuccess });

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

    const configData = {
      ...data.version,
      name: data.name,
    };

    await createVersion.mutateAsync({
      projectId: project.id,
      configId,
      configData,
      schemaVersion: SchemaVersion.V1_0,
      commitMessage: data.version.commitMessage,
    });

    await refetch();
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

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import { usePromptConfigVersionMutation } from "./usePromptConfigVersionMutation";
import { api } from "~/utils/api";

// Types and Schemas ===========================================

export const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
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
});

export const versionSchema = z.object({
  commitMessage: z.string().min(1, "Commit message is required"),
  schemaVersion: z.string().min(1, "Schema version is required"),
});

export const formSchema = promptConfigSchema.extend({
  version: versionSchema,
});

export type PromptConfigFormValues = z.infer<typeof formSchema>;

// Default Values ============================================

export const DEFAULT_CONFIG = {
  name: "",
  description: "",
  prompt: "You are a helpful assistant",
  model: "openai/gpt4-o-mini",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};

export const DEFAULT_VERSION = {
  commitMessage: "",
  schemaVersion: "1.0",
};

export const DEFAULT_VALUES = {
  ...DEFAULT_CONFIG,
  version: DEFAULT_VERSION,
};

// Form Hook ================================================

interface UsePromptConfigFormProps {
  configId: string;
  currentName?: string;
  onSuccess?: () => void;
}

export const usePromptConfigForm = ({
  configId,
  currentName,
  onSuccess,
}: UsePromptConfigFormProps) => {
  const { project } = useOrganizationTeamProject();

  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      ...DEFAULT_VALUES,
      name: currentName ?? "",
    },
    resolver: zodResolver(formSchema),
  });

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
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      model: data.model,
      inputs: data.inputs,
      outputs: data.outputs,
    };

    await createVersion.mutateAsync({
      projectId: project.id,
      configId,
      configData,
      schemaVersion: data.version.schemaVersion,
      commitMessage: data.version.commitMessage,
    });
  };

  return {
    methods,
    handleSubmit: () => {
      void methods.handleSubmit(handleSubmit)();
    },
    isSubmitting: createVersion.isLoading || updateConfig.isLoading,
  };
};

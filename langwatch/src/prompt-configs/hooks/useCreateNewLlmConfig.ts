import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfig } from "@prisma/client";
import {
  LATEST_SCHEMA_VERSION,
  type LatestConfigVersionSchema,
} from "~/server/repositories/llm-config-version-schema";

type InitializeNewLlmConfigProps = Partial<LlmPromptConfig>;

type InitializeNewLlmConfigVersionProps = Partial<LatestConfigVersionSchema>;

export function useInitializeNewLlmConfig() {
  const { project } = useOrganizationTeamProject();
  const createConfig = api.llmConfigs.createPromptConfig.useMutation();
  const createVersion = api.llmConfigs.versions.create.useMutation();

  const initializeNewLlmConfigWithVersion = async (
    newConfig?: InitializeNewLlmConfigProps,
    newVersion?: InitializeNewLlmConfigVersionProps
  ) => {
    if (!project?.id) {
      throw new Error("Project ID is required");
    }

    // Create with defaults
    const config = await createConfig.mutateAsync({
      name: "New Prompt Config",
      projectId: project.id,
      ...newConfig,
    });

    // Create with defaults
    const version = await createVersion.mutateAsync({
      configData: {
        model: "gpt-4o-mini",
        prompt: "You are a helpful assistant",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        demonstrations: {
          columns: [],
          rows: [],
        },
      },
      configId: config.id,
      projectId: project.id,
      schemaVersion: LATEST_SCHEMA_VERSION,
      commitMessage: "Initial version",
      ...newVersion,
    });

    return {
      config,
      version,
    };
  };

  return {
    initializeNewLlmConfigWithVersion,
  };
}

import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories";
import type { LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { llmOutputFieldToJsonSchemaTypeMap } from "../constants";
import type { ApiResponsePromptVersion, ApiResponsePrompt } from "../schemas";

// Helper function to transform config to apiResponsePromptWithVersionDataSchema format
export const mapPromptToApiPromptResponse = (
  config: LlmConfigWithLatestVersion
): ApiResponsePrompt => {
  return {
    id: config.id,
    name: config.name,
    handle: config.handle,
    scope: config.scope,
    version: config.latestVersion.version ?? 0,
    versionId: config.latestVersion.id ?? "",
    versionCreatedAt: config.latestVersion.createdAt ?? new Date(),
    model: config.latestVersion.configData.model,
    prompt: config.latestVersion.configData.prompt,
    updatedAt: config.updatedAt,
    projectId: config.projectId,
    organizationId: config.organizationId,
    messages: buildMessages(config),
    response_format: getOutputsToResponseFormat(config),
  };
};

export function mapVersionToApiPromptVersionResponse(
  version: LatestConfigVersionSchema
): ApiResponsePromptVersion {
  return {
    projectId: version.projectId,
    configId: version.configId,
    versionId: version.id,
    version: version.version,
    commitMessage: version.commitMessage,
    authorId: version.authorId ?? version.author?.id ?? null,
    createdAt: version.createdAt,
    model: version.configData.model,
    prompt: version.configData.prompt,
    messages: version.configData.messages,
    inputs: version.configData.inputs,
    outputs: version.configData.outputs,
  };
}

/**
 * Build messages array from config data.
 *
 * While there shouldn't be a case where both a prompt and a system message are provided,
 * this should have been addressed on ingestion, and this isn't the place to handle it.
 */
function buildMessages(
  config: LlmConfigWithLatestVersion
): ApiResponsePrompt["messages"] {
  const { prompt } = config.latestVersion.configData;
  const messages = [...config.latestVersion.configData.messages];

  if (prompt) {
    messages.unshift({
      role: "system",
      content: prompt,
    });
  }

  return messages;
}

const getOutputsToResponseFormat = (
  config: LlmConfigWithLatestVersion
): ApiResponsePrompt["response_format"] => {
  const outputs = config.latestVersion.configData.outputs;
  if (!outputs.length || (outputs.length === 1 && outputs[0]?.type === "str")) {
    return null;
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "outputs",
      schema: {
        type: "object",
        properties: Object.fromEntries(
          outputs.map((output) => {
            if (output.type === "json_schema") {
              return [
                output.identifier,
                output.json_schema ?? { type: "object", properties: {} },
              ];
            }
            return [
              output.identifier,
              {
                type: llmOutputFieldToJsonSchemaTypeMap[output.type],
              },
            ];
          })
        ),
        required: outputs.map((output) => output.identifier),
      },
    },
  };
};

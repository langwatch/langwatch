import { Factory } from "fishery";
import type { PromptResponse } from "../../src/client-sdk/services/prompts/prompt";

/**
 * Factory for creating PromptResponse objects (API response structure)
 * Used for testing prompt retrieval and manipulation
 */
export const promptResponseFactory = Factory.define<PromptResponse>(
  ({ sequence }) => ({
    id: `prompt_${sequence}`,
    handle: `test-prompt-${sequence}`,
    projectId: "test-project",
    organizationId: "test-organization",
    name: `Test Prompt ${sequence}`,
    scope: "ORGANIZATION" as const,
    updatedAt: new Date().toISOString(),
    version: 1,
    authorId: "test-author",
    createdAt: new Date().toISOString(),
    inputs: [],
    outputs: [],
    versionId: `prompt_version_${sequence}`,
    versionCreatedAt: new Date().toISOString(),
    model: "gpt-5",
    prompt: "Hello {{name}}, how is the {{topic}} today?",
    messages: [
      {
        role: "system" as const,
        content: "You are a helpful assistant.",
      },
      {
        role: "user" as const,
        content: "Tell me about {{topic}}",
      },
    ],
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: "response",
        schema: {},
      },
    },
  }),
);

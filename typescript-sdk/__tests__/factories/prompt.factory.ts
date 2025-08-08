import { Factory } from "fishery";
import type { PromptResponse } from "@/client-sdk/services/prompts/prompt";

/**
 * Factory for creating PromptResponse objects (API response structure)
 * Used for testing prompt retrieval and manipulation
 */
export const promptResponseFactory = Factory.define<PromptResponse>(
  ({ sequence, params }) => {
    // Use the provided ID if available, otherwise use sequence
    const id = params?.id ?? `prompt_${sequence}`;
    const sequenceNumber = id === "prompt_123" ? 1 : sequence;

    return {
      id: id,
      handle: `test-prompt-${sequenceNumber}`,
      name: `Test Prompt ${sequenceNumber}`,
      scope: "ORGANIZATION" as const,
      updatedAt: new Date().toISOString(),
      version: 1,
      versionId: `prompt_version_${sequenceNumber}`,
      versionCreatedAt: new Date().toISOString(),
      model: "gpt-4o-mini",
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
    };
  },
);

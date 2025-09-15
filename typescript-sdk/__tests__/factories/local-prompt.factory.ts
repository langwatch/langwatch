import { Factory } from "fishery";
import { type LocalPromptConfig } from "../../src/cli/types";

/**
 * Factory for creating LocalPromptConfig objects (local configuration structure)
 * Used for testing local prompt configuration and manipulation
 */
export const localPromptFactory = Factory.define<LocalPromptConfig>(
  () => ({
    model: "gpt-5",
    modelParameters: {
      temperature: 0.7,
      max_tokens: 1000,
    },
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
  }),
);

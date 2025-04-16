import { Factory } from "fishery";
import {
  type LlmPromptConfig,
  type LlmPromptConfigVersion,
} from "@prisma/client";
import { nanoid } from "nanoid";

/**
 * Factory for creating LlmPromptConfig objects for testing purposes.
 * This follows the same pattern as the projectFactory to maintain consistency.
 */
export const llmPromptConfigFactory = Factory.define<LlmPromptConfig>(
  ({ sequence }) => ({
    id: nanoid(),
    name: `Test LLM Prompt Config ${sequence}`,
    projectId: nanoid(), // This should be overridden with an actual project ID when used
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  })
);

/**
 * Factory for creating LlmPromptConfigVersion objects for testing purposes.
 */
export const llmPromptConfigVersionFactory =
  Factory.define<LlmPromptConfigVersion>(({ sequence }) => ({
    id: nanoid(),
    version: sequence,
    commitMessage: "Initial configuration",
    authorId: null,
    configId: nanoid(), // This should be overridden with an actual config ID when used
    configData: {
      model: "gpt-3.5-turbo",
      temperature: 0.7,
      maxTokens: 1000,
    },
    schemaVersion: "1.0",
    createdAt: new Date(),
    projectId: nanoid(), // This should be overridden with an actual project ID when used
  }));

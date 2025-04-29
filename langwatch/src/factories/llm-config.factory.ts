import { Factory } from "fishery";
import {
  type LlmPromptConfig,
  type LlmPromptConfigVersion,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  LATEST_SCHEMA_VERSION,
  type SchemaVersion,
  parseLlmConfigVersion,
  type schemaValidators,
} from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { z } from "zod";

/**
 * Factory for creating LlmPromptConfig objects for testing purposes.
 * This follows the same pattern as the projectFactory to maintain consistency.
 */
export const llmPromptConfigFactory = Factory.define<
  LlmPromptConfig & {
    versions?: LlmPromptConfigVersion[];
  }
>(({ sequence }) => ({
  id: nanoid(),
  name: `Test LLM Prompt Config ${sequence}`,
  projectId: nanoid(), // This should be overridden with an actual project ID when used
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}));

type LlmPromptConfigVersionWithConfigData<T extends SchemaVersion> =
  LlmPromptConfigVersion & {
    configData: z.infer<(typeof schemaValidators)[T]>;
  };

/**
 * Factory for creating LlmPromptConfigVersion objects for testing purposes.
 */
export const llmPromptConfigVersionFactory = Factory.define<
  LlmPromptConfigVersionWithConfigData<SchemaVersion>
>(({ sequence, params }) => {
  const schemaVersion = params?.schemaVersion ?? LATEST_SCHEMA_VERSION;

  const configData = params?.configData
    ? parseLlmConfigVersion(params?.configData as any)
    : {
        prompt: "You are a helpful assistant",
        model: "gpt-4o-mini",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        demonstrations: {
          columns: [],
          rows: [],
        },
      };

  return {
    id: nanoid(),
    version: sequence,
    commitMessage: "Initial configuration",
    authorId: null,
    configId: nanoid(), // This should be overridden with an actual config ID when used
    configData,
    schemaVersion,
    createdAt: new Date(),
    projectId: nanoid(), // This should be overridden with an actual project ID when used
  } as LlmPromptConfigVersion & {
    configData: z.infer<
      (typeof schemaValidators)[typeof LATEST_SCHEMA_VERSION]
    >;
  };
});

import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

const latestConfigVersionSchema = getLatestConfigVersionSchema();

export const formSchema = z.object({
  version: z.object({
    configData: z.object({
      prompt: latestConfigVersionSchema.shape.configData.shape.prompt,
      messages: latestConfigVersionSchema.shape.configData.shape.messages,
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs,
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      llm: z.object({
        model: latestConfigVersionSchema.shape.configData.shape.model,
        temperature:
          latestConfigVersionSchema.shape.configData.shape.temperature,
        max_tokens: latestConfigVersionSchema.shape.configData.shape.max_tokens,
        // Additional params attached to the LLM config
        litellm_params: z.record(z.string()).optional(),
      }),
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
      prompting_technique:
        latestConfigVersionSchema.shape.configData.shape.prompting_technique,
    }),
  }),
});


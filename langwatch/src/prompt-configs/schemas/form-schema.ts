import type { DeepPartial } from "react-hook-form";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import type { PromptConfigFormValues } from "~/prompt-configs/hooks/usePromptConfigForm";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  referenceId: z.string().optional(),
});

const latestConfigVersionSchema = getLatestConfigVersionSchema();

export const formSchema = promptConfigSchema.extend({
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

/**
 * Creates a prompt config schema with the reference id field
 * that is validated against the server side uniqueness check.
 *
 * @param params - The parameters for the schema creation.
 * @returns The prompt config schema.
 */
export const createPromptConfigSchemaWithValidators = (params: {
  initialConfigValues: DeepPartial<PromptConfigFormValues>;
  checkReferenceIdUniqueness: (params: {
    referenceId: string;
    excludeId?: string;
  }) => Promise<boolean>;
}) => {
  const { initialConfigValues, checkReferenceIdUniqueness } = params;

  return promptConfigSchema.extend({
    referenceId: z
      .string()
      .optional()
      .refine(
        async (value) => {
          if (!value || value.trim() === "") return true;
          return await checkReferenceIdUniqueness({
            referenceId: value,
            excludeId: initialConfigValues?.referenceId,
          });
        },
        { message: "⚠ Reference id must be unique." }
      ),
    version: formSchema.shape.version,
  });
};

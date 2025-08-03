import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { PromptScope } from "@prisma/client";

const promptConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  handle: z
    .string()
    .optional()
    .refine(
      (value) => {
        if (!value || value.trim() === "") return true;
        // npm package name pattern: allows lowercase letters, numbers, hyphens, and optionally one slash
        const npmPackagePattern = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/;
        return npmPackagePattern.test(value);
      },
      {
        message:
          "Handle should be in the 'team/sample-prompt' format. Only lowercase letters, numbers, hyphens, underscores and up to one slash are allowed.",
      }
    ),
  scope: z.nativeEnum(PromptScope).default("PROJECT"),
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
 * Creates a prompt config schema with the handle field
 * that is validated against the server side uniqueness check.
 *
 * @param params - The parameters for the schema creation.
 * @returns The prompt config schema.
 */
export const createPromptConfigSchemaWithValidators = (params: {
  configId: string;
  checkHandleUniqueness: (params: {
    handle: string;
    scope: PromptScope;
    excludeId?: string;
  }) => Promise<boolean>;
}) => {
  const { configId, checkHandleUniqueness } = params;

  return promptConfigSchema
    .extend({
      version: formSchema.shape.version,
    })
    .superRefine(async (data, ctx) => {
      if (!data.handle || data.handle.trim() === "") return;

      const isUnique = await checkHandleUniqueness({
        handle: data.handle,
        scope: data.scope, // Use the current scope from form data
        excludeId: configId,
      });

      if (!isUnique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `⚠ Prompt "${String(
            data.handle
          )}" already exists on the ${data.scope.toLowerCase()}.`,
          path: ["handle"],
        });
      }
    });
};

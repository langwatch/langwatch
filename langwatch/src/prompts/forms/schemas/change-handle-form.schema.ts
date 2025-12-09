import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { isValidHandle } from "../../../server/prompt-config/repositories/llm-config-version-schema";

export const changeHandleFormSchema = z.object({
  handle: z
    .string()
    .trim()
    .nonempty()
    .refine((value) => isValidHandle(value), {
      message:
        "Handle should be in the 'identifier' or 'namespace/identifier' format. Only lowercase letters, numbers, hyphens, underscores and up to one slash are allowed.",
    }),
  scope: z.nativeEnum(PromptScope).default("PROJECT"),
});

export type ChangeHandleFormValues = z.infer<typeof changeHandleFormSchema>;

/**
 * Creates a change handle form schema
 * that is validated against the server side uniqueness check.
 *
 * @param params - The parameters for the schema creation.
 * @param params.checkHandleUniqueness - The callback function to check the handle uniqueness.
 * @returns The change handle form schema.
 */
export const createChangeHandleFormSchema = (params: {
  checkHandleUniqueness: (params: {
    handle: string;
    scope: PromptScope;
  }) => Promise<boolean>;
}) => {
  const { checkHandleUniqueness } = params;

  return changeHandleFormSchema.superRefine(async (data, ctx) => {
    if (!data.handle || data.handle.trim() === "") return;
    if (!isValidHandle(data.handle)) return;

    const isUnique = await checkHandleUniqueness({
      handle: data.handle,
      scope: data.scope,
    });

    if (!isUnique) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `⚠ Prompt "${String(
          data.handle,
        )}" already exists on the ${data.scope.toLowerCase()}.`,
        path: ["handle"],
      });
    }
  });
};

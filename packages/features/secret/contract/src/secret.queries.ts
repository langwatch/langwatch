import type { AuthzPermission } from "@langwatch/authz-contract";
import { z, type ZodType } from "zod";
import {
  secretIdSchema,
  secretNameSchema,
  secretValueSchema,
  storedSecretNameSchema,
  type Secret,
} from "./secret";

export const secretPublicSchema = z
  .object({
    id: secretIdSchema,
    projectId: z.string().min(1),
    name: storedSecretNameSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type SecretPublic = z.infer<typeof secretPublicSchema>;

export const secretPublicListInputSchema = z.object({ projectId: z.string().min(1) }).strict();
export type SecretPublicListInput = z.infer<typeof secretPublicListInputSchema>;

export const secretPublicGetInputSchema = secretPublicListInputSchema.extend({
  id: secretIdSchema,
});
export type SecretPublicGetInput = z.infer<typeof secretPublicGetInputSchema>;

export const secretPublicCreateInputSchema = secretPublicListInputSchema.extend({
  name: secretNameSchema,
  value: secretValueSchema,
});
export type SecretPublicCreateInput = z.infer<typeof secretPublicCreateInputSchema>;

export const secretPublicUpdateInputSchema = secretPublicListInputSchema.extend({
  id: secretIdSchema,
  value: secretValueSchema,
});
export type SecretPublicUpdateInput = z.infer<typeof secretPublicUpdateInputSchema>;

export const secretPublicDeleteInputSchema = secretPublicGetInputSchema;
export type SecretPublicDeleteInput = SecretPublicGetInput;

export const secretPublicDeleteOutputSchema = z
  .object({ id: secretIdSchema, deleted: z.literal(true) })
  .strict();
export type SecretPublicDeleteOutput = z.infer<typeof secretPublicDeleteOutputSchema>;

interface SecretRestOperation<Input extends ZodType, Output extends ZodType> {
  readonly input: Input;
  readonly output: Output;
  readonly permission: AuthzPermission;
}

export const secretPublicRest = {
  list: {
    input: secretPublicListInputSchema,
    output: z.array(secretPublicSchema),
    permission: "secrets:view",
  },
  get: {
    input: secretPublicGetInputSchema,
    output: secretPublicSchema,
    permission: "secrets:view",
  },
  create: {
    input: secretPublicCreateInputSchema,
    output: secretPublicSchema,
    permission: "secrets:manage",
  },
  update: {
    input: secretPublicUpdateInputSchema,
    output: secretPublicSchema,
    permission: "secrets:manage",
  },
  delete: {
    input: secretPublicDeleteInputSchema,
    output: secretPublicDeleteOutputSchema,
    permission: "secrets:manage",
  },
} as const satisfies Record<string, SecretRestOperation<ZodType, ZodType>>;

export function toSecretPublic(secret: Secret): SecretPublic {
  return secretPublicSchema.parse({
    id: secret.id,
    projectId: secret.projectId,
    name: secret.name,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
  });
}

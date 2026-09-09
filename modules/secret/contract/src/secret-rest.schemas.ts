/**
 * What the REST family publishes. `secretPublicSchema` is the SAFE projection:
 * id, project, name and the two timestamps, `.strict()`, so an encrypted or
 * plaintext value cannot join an answer by accident — it would fail the parse.
 */

import { z } from "zod";
import {
  secretIdSchema,
  secretNameSchema,
  secretValueSchema,
  storedSecretNameSchema,
  type Secret,
} from "./secret.ts";

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

export const secretPublicParamsSchema = z.object({ id: secretIdSchema }).strict();
export type SecretPublicParams = z.infer<typeof secretPublicParamsSchema>;

/**
 * The delete body, deliberately not `.strict()`: the id it addresses is in the
 * path, and a released client that also puts it in the body is not refused.
 */
export const secretPublicDeleteInputSchema = z.object({ projectId: z.string().min(1) });
export type SecretPublicDeleteInput = z.infer<typeof secretPublicDeleteInputSchema>;

export const secretPublicCreateInputSchema = z
  .object({
    ...secretPublicListInputSchema.shape,
    name: secretNameSchema,
    value: secretValueSchema,
  })
  .strict();
export type SecretPublicCreateInput = z.infer<typeof secretPublicCreateInputSchema>;

export const secretPublicUpdateInputSchema = z
  .object({ ...secretPublicListInputSchema.shape, value: secretValueSchema })
  .strict();
export type SecretPublicUpdateInput = z.infer<typeof secretPublicUpdateInputSchema>;

export const secretPublicDeleteOutputSchema = z
  .object({ id: secretIdSchema, deleted: z.literal(true) })
  .strict();
export type SecretPublicDeleteOutput = z.infer<typeof secretPublicDeleteOutputSchema>;

export function toSecretPublic(secret: Secret): SecretPublic {
  return secretPublicSchema.parse({
    id: secret.id,
    projectId: secret.projectId,
    name: secret.name,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
  });
}

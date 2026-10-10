/**
 * What the REST family publishes. `secretPublicSchema` is the SAFE projection:
 * id, project, name and the two timestamps, `.strict()`, so an encrypted or
 * plaintext value cannot join an answer by accident — it would fail the parse.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  secretIdSchema,
  secretNameSchema,
  secretValueSchema,
  storedSecretNameSchema,
  type Secret,
} from "./secret.ts";

const secretPublicSchemaDefinition = z
  .object({
    id: secretIdSchema,
    projectId: z.string().min(1),
    name: storedSecretNameSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export interface SecretPublicSchema extends Named<typeof secretPublicSchemaDefinition> {}
export const secretPublicSchema: SecretPublicSchema = secretPublicSchemaDefinition;
export type SecretPublic = z.infer<typeof secretPublicSchema>;

/** Optional as on main, which read the project from the credential alone. */
const secretPublicListInputSchemaDefinition = z
  .object({ projectId: z.string().min(1).optional() })
  .strict();
export interface SecretPublicListInputSchema extends Named<
  typeof secretPublicListInputSchemaDefinition
> {}
export const secretPublicListInputSchema: SecretPublicListInputSchema =
  secretPublicListInputSchemaDefinition;

/** `/api/secrets` addresses a secret as `{id}`, the name main published it under. */
const secretPublicAliasParamsSchemaDefinition = z.object({ id: secretIdSchema }).strict();
export interface SecretPublicAliasParamsSchema extends Named<
  typeof secretPublicAliasParamsSchemaDefinition
> {}
export const secretPublicAliasParamsSchema: SecretPublicAliasParamsSchema =
  secretPublicAliasParamsSchemaDefinition;

/**
 * The delete body, deliberately not `.strict()`: the id it addresses is in the
 * path, and a released client that also puts it in the body is not refused.
 */
const secretPublicDeleteInputSchemaDefinition = z.object({
  projectId: z.string().min(1).optional(),
});
export interface SecretPublicDeleteInputSchema extends Named<
  typeof secretPublicDeleteInputSchemaDefinition
> {}
export const secretPublicDeleteInputSchema: SecretPublicDeleteInputSchema =
  secretPublicDeleteInputSchemaDefinition;
export type SecretPublicDeleteInput = z.infer<typeof secretPublicDeleteInputSchema>;

const secretPublicCreateInputSchemaDefinition = z
  .object({
    ...secretPublicListInputSchema.shape,
    name: secretNameSchema,
    value: secretValueSchema,
  })
  .strict();
export interface SecretPublicCreateInputSchema extends Named<
  typeof secretPublicCreateInputSchemaDefinition
> {}
export const secretPublicCreateInputSchema: SecretPublicCreateInputSchema =
  secretPublicCreateInputSchemaDefinition;
export type SecretPublicCreateInput = z.infer<typeof secretPublicCreateInputSchema>;

const secretPublicUpdateInputSchemaDefinition = z
  .object({ ...secretPublicListInputSchema.shape, value: secretValueSchema })
  .strict();
export interface SecretPublicUpdateInputSchema extends Named<
  typeof secretPublicUpdateInputSchemaDefinition
> {}
export const secretPublicUpdateInputSchema: SecretPublicUpdateInputSchema =
  secretPublicUpdateInputSchemaDefinition;
export type SecretPublicUpdateInput = z.infer<typeof secretPublicUpdateInputSchema>;

const secretPublicDeleteOutputSchemaDefinition = z
  .object({ id: secretIdSchema, deleted: z.literal(true) })
  .strict();
export interface SecretPublicDeleteOutputSchema extends Named<
  typeof secretPublicDeleteOutputSchemaDefinition
> {}
export const secretPublicDeleteOutputSchema: SecretPublicDeleteOutputSchema =
  secretPublicDeleteOutputSchemaDefinition;

export function toSecretPublic(secret: Secret): SecretPublic {
  return secretPublicSchema.parse({
    id: secret.id,
    projectId: secret.projectId,
    name: secret.name,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
  });
}

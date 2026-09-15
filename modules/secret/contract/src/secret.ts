import { z } from "zod";

export const SECRET_FEATURE_ID = "secret" as const;
export const SECRET_KSUID_RESOURCE = "secret";
export const MAX_SECRETS_PER_PROJECT = 50;
export const MAX_SECRET_VALUE_LENGTH = 10_000;
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Holds the plaintext secret of the project's auto-provisioned Langy virtual
 * key. Langy reads it back to authenticate against the gateway, and treats its
 * presence as "this project already has a VK" — so deleting the row does not
 * just break the current key, it makes the next chat mint a duplicate VK while
 * the original stays active.
 */
export const LANGY_VK_SECRET_NAME = "langy_vk_secret";

/**
 * Secrets reserved by the product and hidden from project listings. Defined in the contract
 * so every composition root enforces the same promise: product-owned credentials cannot be
 * edited or deleted by customers.
 */
export const RESERVED_PROJECT_SECRET_NAMES: readonly string[] = [LANGY_VK_SECRET_NAME];

export const secretIdSchema = z.string().min(1);
export const secretProjectIdSchema = z.string().min(1);
export const secretActorIdSchema = z.string().min(1);
export const storedSecretNameSchema = z.string().min(1);

export const secretNameSchema = z
  .string()
  .min(1, "Secret name is required")
  .regex(
    SECRET_NAME_PATTERN,
    "Secret name must contain only uppercase letters, digits, and underscores, and must start with a letter",
  );

export const secretValueSchema = z
  .string()
  .min(1, "Secret value is required")
  .max(MAX_SECRET_VALUE_LENGTH, "Secret value is too long");

export const secretActorSchema = z.object({ name: z.string().nullable() }).strict();

/** Safe metadata. The encrypted value is deliberately absent. */
export const secretSchema = z
  .object({
    id: secretIdSchema,
    projectId: secretProjectIdSchema,
    name: storedSecretNameSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
    createdBy: secretActorSchema,
    updatedBy: secretActorSchema,
  })
  .strict();
export type Secret = z.infer<typeof secretSchema>;

export const listSecretsInputSchema = z.object({ projectId: secretProjectIdSchema }).strict();
export type ListSecretsInput = z.infer<typeof listSecretsInputSchema>;

export const getSecretInputSchema = z
  .object({ projectId: secretProjectIdSchema, id: secretIdSchema })
  .strict();
export type GetSecretInput = z.infer<typeof getSecretInputSchema>;

export const createSecretInputSchema = z
  .object({
    projectId: secretProjectIdSchema,
    name: secretNameSchema,
    value: secretValueSchema,
    actorId: secretActorIdSchema,
  })
  .strict();
export type CreateSecretInput = z.infer<typeof createSecretInputSchema>;

export const updateSecretInputSchema = z
  .object({
    projectId: secretProjectIdSchema,
    id: secretIdSchema,
    value: secretValueSchema,
    actorId: secretActorIdSchema,
  })
  .strict();
export type UpdateSecretInput = z.infer<typeof updateSecretInputSchema>;

export const deleteSecretInputSchema = getSecretInputSchema;
export type DeleteSecretInput = GetSecretInput;

/** What the tRPC write procedures answer with: the write landed. */
export const secretWriteAcknowledgedSchema = z.object({ success: z.boolean() }).strict();
export type SecretWriteAcknowledged = z.infer<typeof secretWriteAcknowledgedSchema>;

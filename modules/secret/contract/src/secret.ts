import type { Named } from "@langwatch/module";
import { z } from "zod";

export const SECRET_FEATURE_ID = "secret" as const;
export const SECRET_KSUID_RESOURCE = "secret";
export const MAX_SECRETS_PER_PROJECT = 50;
export const MAX_SECRET_VALUE_LENGTH = 10_000;
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Langy treats this row as proof a virtual key exists; deleting it makes the
 * next chat mint a duplicate while the original remains active.
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

const secretActorSchemaDefinition = z.object({ name: z.string().nullable() }).strict();
export interface SecretActorSchema extends Named<typeof secretActorSchemaDefinition> {}
export const secretActorSchema: SecretActorSchema = secretActorSchemaDefinition;

/** Safe metadata. The encrypted value is deliberately absent. */
const secretSchemaDefinition = z
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
export interface SecretSchema extends Named<typeof secretSchemaDefinition> {}
export const secretSchema: SecretSchema = secretSchemaDefinition;
export type Secret = z.infer<typeof secretSchema>;

const listSecretsInputSchemaDefinition = z.object({ projectId: secretProjectIdSchema }).strict();
export interface ListSecretsInputSchema extends Named<typeof listSecretsInputSchemaDefinition> {}
export const listSecretsInputSchema: ListSecretsInputSchema = listSecretsInputSchemaDefinition;
export type ListSecretsInput = z.infer<typeof listSecretsInputSchema>;

/** Reads only the secrets a config names; a reserved name answers as an unknown one. */
const getSecretValuesByNameInputSchemaDefinition = z
  .object({ projectId: secretProjectIdSchema, names: z.array(storedSecretNameSchema) })
  .strict();
export interface GetSecretValuesByNameInputSchema extends Named<
  typeof getSecretValuesByNameInputSchemaDefinition
> {}
export const getSecretValuesByNameInputSchema: GetSecretValuesByNameInputSchema =
  getSecretValuesByNameInputSchemaDefinition;
export type GetSecretValuesByNameInput = z.infer<typeof getSecretValuesByNameInputSchema>;

/** A `{{ secrets.NAME }}` reference, spelled as the workflow engine resolves it. */
export const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Every secret name the `{{ secrets.NAME }}` references anywhere in `referencing` name. */
export function referencedSecretNames(referencing: unknown): string[] {
  const names = stringsIn(referencing).flatMap((text) =>
    Array.from(text.matchAll(SECRET_REFERENCE), ([, name = ""]) => name),
  );

  return [...new Set(names)];
}

/** Each string leaf as written, so a reference spanning a newline still matches. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);

  return [];
}

const getSecretInputSchemaDefinition = z
  .object({ projectId: secretProjectIdSchema, id: secretIdSchema })
  .strict();
export interface GetSecretInputSchema extends Named<typeof getSecretInputSchemaDefinition> {}
export const getSecretInputSchema: GetSecretInputSchema = getSecretInputSchemaDefinition;
export type GetSecretInput = z.infer<typeof getSecretInputSchema>;

const createSecretInputSchemaDefinition = z
  .object({
    projectId: secretProjectIdSchema,
    name: secretNameSchema,
    value: secretValueSchema,
    actorId: secretActorIdSchema,
  })
  .strict();
export interface CreateSecretInputSchema extends Named<typeof createSecretInputSchemaDefinition> {}
export const createSecretInputSchema: CreateSecretInputSchema = createSecretInputSchemaDefinition;
export type CreateSecretInput = z.infer<typeof createSecretInputSchema>;

/** A product-owned credential under a reserved name, written by the feature that owns it. */
const createReservedSecretInputSchemaDefinition = z
  .object({
    projectId: secretProjectIdSchema,
    name: storedSecretNameSchema,
    value: secretValueSchema,
    actorId: secretActorIdSchema,
  })
  .strict();
export interface CreateReservedSecretInputSchema extends Named<
  typeof createReservedSecretInputSchemaDefinition
> {}
export const createReservedSecretInputSchema: CreateReservedSecretInputSchema =
  createReservedSecretInputSchemaDefinition;
export type CreateReservedSecretInput = z.infer<typeof createReservedSecretInputSchema>;

const updateSecretInputSchemaDefinition = z
  .object({
    projectId: secretProjectIdSchema,
    id: secretIdSchema,
    value: secretValueSchema,
    actorId: secretActorIdSchema,
  })
  .strict();
export interface UpdateSecretInputSchema extends Named<typeof updateSecretInputSchemaDefinition> {}
export const updateSecretInputSchema: UpdateSecretInputSchema = updateSecretInputSchemaDefinition;
export type UpdateSecretInput = z.infer<typeof updateSecretInputSchema>;

export type DeleteSecretInput = GetSecretInput;

/** What the tRPC write procedures answer with: the write landed. */
const secretWriteAcknowledgedSchemaDefinition = z.object({ success: z.boolean() }).strict();
export interface SecretWriteAcknowledgedSchema extends Named<
  typeof secretWriteAcknowledgedSchemaDefinition
> {}
export const secretWriteAcknowledgedSchema: SecretWriteAcknowledgedSchema =
  secretWriteAcknowledgedSchemaDefinition;
export type SecretWriteAcknowledged = z.infer<typeof secretWriteAcknowledgedSchema>;

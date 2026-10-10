import type { Named } from "@langwatch/module";
import { z } from "zod";

const cliClientInfoSchemaDefinition = z
  .object({
    device_label: z.string().optional(),
    hostname: z.string().optional(),
    uname: z.string().optional(),
    platform: z.string().optional(),
    session_started_at: z.number().int().nonnegative().optional(),
  })
  .strict();
export interface CliClientInfoSchema extends Named<typeof cliClientInfoSchemaDefinition> {}
export const cliClientInfoSchema: CliClientInfoSchema = cliClientInfoSchemaDefinition;

const cliTokenRecordSchemaDefinition = z
  .object({
    user_id: z.string().min(1),
    organization_id: z.string().min(1),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
    client_info: cliClientInfoSchema.optional(),
  })
  .passthrough();
export interface CliTokenRecordSchema extends Named<typeof cliTokenRecordSchemaDefinition> {}
export const cliTokenRecordSchema: CliTokenRecordSchema = cliTokenRecordSchemaDefinition;
export type CliTokenRecord = z.infer<typeof cliTokenRecordSchema>;

const cliSessionSchemaDefinition = z
  .object({
    sessionStartedAtMs: z.number().int().nonnegative(),
    deviceLabel: z.string(),
    hostname: z.string().nullable(),
    uname: z.string().nullable(),
    platform: z.string().nullable(),
    organizationId: z.string(),
    cliApiKeyId: z.string().nullable(),
    lastSeenMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().nonnegative(),
    tokenKeys: z.array(z.string().min(1)),
  })
  .strict();
export interface CliSessionSchema extends Named<typeof cliSessionSchemaDefinition> {}
export const cliSessionSchema: CliSessionSchema = cliSessionSchemaDefinition;
export type CliSession = z.infer<typeof cliSessionSchema>;

/**
 * One session as the Devices dashboard renders it: everything on the record
 * except the token keys, which identify live credentials and belong to the
 * revocation path rather than to a card on a screen.
 */
const cliSessionCardSchemaDefinition = cliSessionSchema.omit({
  tokenKeys: true,
  organizationId: true,
});
export interface CliSessionCardSchema extends Named<typeof cliSessionCardSchemaDefinition> {}
export const cliSessionCardSchema: CliSessionCardSchema = cliSessionCardSchemaDefinition;
export type CliSessionCard = z.infer<typeof cliSessionCardSchema>;

/** What a revocation answers: that it happened, and how many tokens it took. */
const cliSessionRevocationSchemaDefinition = z
  .object({
    ok: z.boolean(),
    revokedTokens: z.number().int().nonnegative(),
    revokedKeys: z.number().int().nonnegative(),
  })
  .strict();
export interface CliSessionRevocationSchema extends Named<
  typeof cliSessionRevocationSchemaDefinition
> {}
export const cliSessionRevocationSchema: CliSessionRevocationSchema =
  cliSessionRevocationSchemaDefinition;
export type CliSessionRevocation = z.infer<typeof cliSessionRevocationSchema>;

const cliUserInputSchemaDefinition = z.object({ userId: z.string().min(1) }).strict();
export interface CliUserInputSchema extends Named<typeof cliUserInputSchemaDefinition> {}
export const cliUserInputSchema: CliUserInputSchema = cliUserInputSchemaDefinition;
export type CliUserInput = z.infer<typeof cliUserInputSchema>;

const revokeCliSessionInputSchemaDefinition = cliUserInputSchema
  .safeExtend({ sessionStartedAtMs: z.number().int().nonnegative() })
  .strict();
export interface RevokeCliSessionInputSchema extends Named<
  typeof revokeCliSessionInputSchemaDefinition
> {}
export const revokeCliSessionInputSchema: RevokeCliSessionInputSchema =
  revokeCliSessionInputSchemaDefinition;
export type RevokeCliSessionInput = z.infer<typeof revokeCliSessionInputSchema>;

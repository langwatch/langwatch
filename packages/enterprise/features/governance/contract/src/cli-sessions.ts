import { z } from "zod";

export const cliClientInfoSchema = z
  .object({
    device_label: z.string().optional(),
    hostname: z.string().optional(),
    uname: z.string().optional(),
    platform: z.string().optional(),
    session_started_at: z.number().int().nonnegative().optional(),
  })
  .strict();

export const cliTokenRecordSchema = z
  .object({
    user_id: z.string().min(1),
    organization_id: z.string().min(1),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().nonnegative(),
    client_info: cliClientInfoSchema.optional(),
  })
  .passthrough();
export type CliTokenRecord = z.infer<typeof cliTokenRecordSchema>;

export const cliSessionSchema = z
  .object({
    sessionStartedAtMs: z.number().int().nonnegative(),
    deviceLabel: z.string(),
    hostname: z.string().nullable(),
    uname: z.string().nullable(),
    platform: z.string().nullable(),
    lastSeenMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().nonnegative(),
    tokenKeys: z.array(z.string().min(1)),
  })
  .strict();
export type CliSession = z.infer<typeof cliSessionSchema>;

export const cliUserInputSchema = z.object({ userId: z.string().min(1) }).strict();
export type CliUserInput = z.infer<typeof cliUserInputSchema>;

export const revokeCliSessionInputSchema = cliUserInputSchema
  .extend({ sessionStartedAtMs: z.number().int().nonnegative() })
  .strict();
export type RevokeCliSessionInput = z.infer<typeof revokeCliSessionInputSchema>;

export function cliUserTokensIndexKey(userId: string): string {
  return `lwcli:user:${userId}:tokens`;
}

export function cliAccessTokenKey(token: string): string {
  return `lwcli:access:${token}`;
}

export function cliRefreshTokenKey(token: string): string {
  return `lwcli:refresh:${token}`;
}

export abstract class GovernanceCliTokenRevocationService {
  abstract revokeForUser(input: CliUserInput): Promise<{ revokedCount: number }>;
}

export abstract class GovernanceCliSessionInventoryService {
  abstract listForUser(input: CliUserInput): Promise<CliSession[]>;
  abstract revokeSession(
    input: RevokeCliSessionInput,
  ): Promise<{ revokedTokens: number }>;
}

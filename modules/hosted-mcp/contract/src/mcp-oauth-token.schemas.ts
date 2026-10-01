import { z } from "zod";

/** The encrypted bearer record shared by the in-memory cache and Redis. */
export const mcpOAuthTokenRecordSchema = z.object({
  encryptedApiKey: z.string(),
  userId: z.string().optional(),
  expiresAt: z.number(),
});

/** The one-time authorization-code record written by the consent flow. */
export const mcpAuthorizationCodeRecordSchema = z.object({
  projectId: z.string(),
  encryptedApiKey: z.string(),
  userId: z.string().optional(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  redirectUri: z.string(),
  clientId: z.string(),
  expiresAt: z.number(),
});

export type McpOAuthTokenRecord = z.infer<typeof mcpOAuthTokenRecordSchema>;
export type McpAuthorizationCodeRecord = z.infer<typeof mcpAuthorizationCodeRecordSchema>;

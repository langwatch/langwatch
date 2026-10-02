import { z } from "zod";

/** The one-time authorization-code record written by the consent flow. */
export const mcpAuthorizationCodeRecordSchema = z.object({
  projectId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  redirectUri: z.string(),
  clientId: z.string(),
  expiresAt: z.number(),
});

export type McpAuthorizationCodeRecord = z.infer<typeof mcpAuthorizationCodeRecordSchema>;

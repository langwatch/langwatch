import { z } from "zod";

export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_VERIFICATION_URL = `${CODEX_OAUTH_ISSUER}/codex/device`;
export const CODEX_SIGN_IN_TTL_MS = 15 * 60 * 1000;

export const codexTokenKeysSchema = z.object({
  CODEX_ACCESS_TOKEN: z.string().min(1),
  CODEX_REFRESH_TOKEN: z.string().min(1),
  CODEX_ID_TOKEN: z.string(),
  CODEX_ACCOUNT_ID: z.string(),
  CODEX_PLAN: z.string(),
  CODEX_EMAIL: z.string(),
  CODEX_TOKENS_SAVED_AT: z.string(),
}).strict();
export type CodexTokenKeys = z.infer<typeof codexTokenKeysSchema>;

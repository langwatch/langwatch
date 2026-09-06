import { z } from "zod";

/**
 * The Codex provider's credential shape and OAuth constants — pure module,
 * safe on both sides: the server registry references the schema, the setup
 * UI references the verification URL, and the auth engine
 * (codexAccount.service.ts, server-only) implements the flow around them.
 *
 * Spec: specs/model-providers/codex-account-provider.feature
 */

export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
/** The codex CLI's public OAuth client — approvals land on OpenAI's official
 *  Codex grant screen. */
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** Where the user types the one-time code. */
export const CODEX_VERIFICATION_URL = `${CODEX_OAUTH_ISSUER}/codex/device`;

/** How long a sign-in may stay pending before we call it timed out. */
export const CODEX_SIGN_IN_TTL_MS = 15 * 60 * 1000;

/**
 * The token set stored (encrypted) as the codex provider's credential keys.
 * Field names double as the provider's `keysSchema` keys, so the standard
 * customKeys encryption, scope and repository paths apply unchanged.
 */
export const codexTokenKeysSchema = z.object({
  CODEX_ACCESS_TOKEN: z.string().min(1),
  CODEX_REFRESH_TOKEN: z.string().min(1),
  CODEX_ID_TOKEN: z.string(),
  /** ChatGPT account id from the id-token claims — a request header. */
  CODEX_ACCOUNT_ID: z.string(),
  /** Plan type from the claims (plus, pro, team, ...) — display only. */
  CODEX_PLAN: z.string(),
  /** Account email from the claims — display only. */
  CODEX_EMAIL: z.string(),
  /** ISO timestamp of the last token save — drives proactive refresh. */
  CODEX_TOKENS_SAVED_AT: z.string(),
});
export type CodexTokenKeys = z.infer<typeof codexTokenKeysSchema>;

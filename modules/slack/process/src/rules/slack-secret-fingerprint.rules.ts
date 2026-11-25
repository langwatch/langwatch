import { createHmac } from "node:crypto";

/**
 * Stable identity for a Slack secret without storing it in the clear: one secret
 * is one connection per scope (ADR-093 §5a). Keyed so a leaked table cannot be
 * brute-forced; the key is main's `CREDENTIALS_SECRET ?? NEXTAUTH_SECRET`.
 */
export function slackSecretFingerprint({ secret, key }: { secret: string; key: string }): string {
  return createHmac("sha256", `slack-connection:${key}`).update(secret.trim()).digest("hex");
}

import { createHmac } from "node:crypto";
import { env } from "~/env.mjs";

/**
 * Stable identity for a Slack secret without storing it in the clear. The
 * ciphertext has a random IV, so this is what makes one secret one connection
 * per organization (ADR-093 §5a). Keyed so a leaked table cannot be brute-forced.
 */
export function slackSecretFingerprint({ secret }: { secret: string }): string {
  const key = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!key) throw new Error("CREDENTIALS_SECRET is not set");
  return createHmac("sha256", `slack-connection:${key}`)
    .update(secret.trim())
    .digest("hex");
}

/** The last four characters, the only part of a secret a client ever sees. */
export function slackSecretHint({ secret }: { secret: string }): string {
  return secret.trim().slice(-4);
}

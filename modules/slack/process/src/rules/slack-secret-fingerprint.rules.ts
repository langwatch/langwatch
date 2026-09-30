import { createHmac } from "node:crypto";

import type { SlackConnectionKind } from "@langwatch/slack-contract";

/**
 * Stable identity for a Slack secret without storing it in the clear: one secret
 * is one connection per scope (ADR-093 §5a). Keyed so a leaked table cannot be
 * brute-forced; the key is main's `CREDENTIALS_SECRET ?? NEXTAUTH_SECRET`.
 */
export function slackSecretFingerprint({ secret, key }: { secret: string; key: string }): string {
  return createHmac("sha256", `slack-connection:${key}`).update(secret.trim()).digest("hex");
}

/** The last four characters, the only part of a secret a client ever sees. */
export function slackSecretHint({ secret }: { secret: string }): string {
  return secret.trim().slice(-4);
}

/** `Slack bot ••••abcd` / `Slack webhook ••••abcd`: a connection's default name. */
export function defaultSlackConnectionName({
  kind,
  secret,
}: {
  kind: SlackConnectionKind;
  secret: string;
}): string {
  const noun = kind === "BOT" ? "bot" : "webhook";
  return `Slack ${noun} ••••${slackSecretHint({ secret })}`;
}

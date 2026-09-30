import type { SlackConnectionKind } from "./slack.schemas.ts";

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

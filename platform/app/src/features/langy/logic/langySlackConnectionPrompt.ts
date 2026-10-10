/**
 * When a failed step is a Slack automation that named no Slack connection.
 *
 * The public API has no read that lists Slack connections, so Langy cannot
 * pick one. Its Slack create is refused instead, and the panel answers that
 * refusal by listing the connections the viewer's own session can see.
 * Spec: specs/langy/langy-automations.feature.
 */
import { commandOfToolCall } from "./langyCapabilityDigest";

const WRITE_VERBS = new Set(["create", "update"]);
const CONNECTION_FLAGS = ["slack-connection", "slackConnection"];
const CHANNEL_FLAGS = ["slack-channel", "slackChannel"];

/** True when the failed call asked for Slack delivery without a connection. */
export function isSlackConnectionRefusal({
  name,
  input,
}: {
  name: string;
  input: unknown;
}): boolean {
  const command = commandOfToolCall({ name, input });
  if (command?.resource !== "trigger") return false;
  if (!WRITE_VERBS.has(command.verb)) return false;
  if (CONNECTION_FLAGS.some((flag) => hasValue(command.query[flag]))) {
    return false;
  }
  const action = command.query.action;
  const asksForSlack =
    (typeof action === "string" &&
      action.toUpperCase() === "SEND_SLACK_MESSAGE") ||
    CHANNEL_FLAGS.some((flag) => hasValue(command.query[flag]));
  return asksForSlack;
}

/** The Slack channel the refused call named, if any, to carry into the answer. */
export function refusedSlackChannel({
  name,
  input,
}: {
  name: string;
  input: unknown;
}): string | null {
  const command = commandOfToolCall({ name, input });
  if (!command) return null;
  for (const flag of CHANNEL_FLAGS) {
    const value = command.query[flag];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** What choosing a connection tells Langy: its name and id, never a secret. */
export function slackConnectionChoiceMessage({
  connection,
  channel,
}: {
  connection: { id: string; name: string };
  channel: string | null;
}): string {
  const where = channel ? ` and post in ${channel}` : "";
  return `Use the Slack connection "${connection.name}" (id ${connection.id})${where}.`;
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value === true;
}

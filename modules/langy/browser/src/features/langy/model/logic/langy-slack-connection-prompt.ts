/**
 * When a failed step is a Slack automation that named no Slack connection: the public API lists
 * none, so the create is refused and the panel lists the viewer's own. Spec: langy-automations.
 */
import { commandOfToolCall } from "../../../../model/langy-capability-digest.ts";

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
  if (CONNECTION_FLAGS.some((flag) => hasValue(command.query[flag]))) return false;
  const action = command.query.action;
  return (
    (typeof action === "string" && action.toUpperCase() === "SEND_SLACK_MESSAGE") ||
    CHANNEL_FLAGS.some((flag) => hasValue(command.query[flag]))
  );
}

/** The Slack channel the refused call named, if any, to carry into the answer. */
export function refusedSlackChannel({
  name,
  input,
}: {
  name: string;
  input: unknown;
}): string | undefined {
  const command = commandOfToolCall({ name, input });
  if (!command) return undefined;
  for (const flag of CHANNEL_FLAGS) {
    const value = command.query[flag];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** What choosing a connection tells Langy: its name and id, never a secret. */
export function slackConnectionChoiceMessage({
  connection,
  channel,
}: {
  connection: { id: string; name: string };
  channel: string | undefined;
}): string {
  const where = channel ? ` and post in ${channel}` : "";
  return `Use the Slack connection "${connection.name}" (id ${connection.id})${where}.`;
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value === true;
}

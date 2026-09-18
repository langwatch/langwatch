import type { LocalToolCall } from "@langwatch/langy-contract";

/** The longest command the activity line shows before it trails off. */
const ACTIVITY_COMMAND_CAP = 120;

/** What the panel says while one call runs on the developer's machine. */
export function callActivityLine({
  call,
  machine,
}: {
  call: LocalToolCall;
  machine: string;
}): string {
  if (call.tool === "local_bash") {
    const command = call.params.command.replace(/\s+/g, " ").trim();
    const shown =
      command.length > ACTIVITY_COMMAND_CAP
        ? `${command.slice(0, ACTIVITY_COMMAND_CAP)}...`
        : command;
    return `Running on ${machine}: ${shown}`;
  }
  if (call.tool === "local_write" || call.tool === "local_edit") {
    return `Editing on ${machine}`;
  }
  return `Reading on ${machine}`;
}

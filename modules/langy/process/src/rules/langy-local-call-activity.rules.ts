import type { LocalToolCall } from "@langwatch/langy-contract";

/** "Ada's machine" from the person's name, else the machine's own name, else "your machine". */
function machineLabel({
  personName,
  hostname,
}: {
  personName: string | null;
  hostname: string | null;
}): string {
  const firstName = personName?.trim().split(/\s+/)[0];
  if (firstName) return `${firstName}'s machine`;
  return hostname?.trim() || "your machine";
}

/**
 * What the panel says while one call runs on the developer's machine. Never the
 * command itself: the card already shows it, and a raw uv line reads as noise.
 */
export function callActivityLine({
  call,
  personName,
  hostname,
}: {
  call: LocalToolCall;
  personName: string | null;
  hostname: string | null;
}): string {
  const machine = machineLabel({ personName, hostname });
  if (call.tool === "local_bash") return `Running on ${machine}`;
  if (
    call.tool === "local_write" ||
    call.tool === "local_edit" ||
    call.tool === "local_langwatch_env"
  ) {
    return `Editing on ${machine}`;
  }
  return `Reading on ${machine}`;
}

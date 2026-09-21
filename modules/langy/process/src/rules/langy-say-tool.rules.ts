import type { LangyStreamEntry } from "@langwatch/langy-contract";

/** The worker tool that says a line to the reader where the call happens. */
export const SAY_TOOL = "say";

/**
 * The words a `say` tool entry carries, or "" for any other entry. The panel
 * draws them as reply prose, so a turn that said a line this way has spoken
 * even when it wrote no delta.
 */
export function sayEntryText(entry: LangyStreamEntry): string {
  if (entry.type !== "tool" || entry.name !== SAY_TOOL) return "";
  const input = entry.input as { text?: unknown } | undefined;
  const text = typeof input?.text === "string" ? input.text : "";
  return text.trim() === "" ? "" : text;
}

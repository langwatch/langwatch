/**
 * The `say` tool is a line of Langy's own words, drawn where the call happened
 * rather than gathered at the end of the turn: it arrives as `tool-say` (or a
 * `dynamic-tool` named `say`) carrying `{ text }`, drawn as reply prose.
 */

interface SayToolPartLike {
  type?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
}

/**
 * States in which the line is on screen. While the call is still streaming its
 * input the text may be half a sentence, and a call that errored was refused
 * by the worker; nothing renders from either.
 */
const SAID_STATES = new Set(["input-available", "output-available", "output-denied"]);

/** Is this part the agent's `say` tool call? */
export function isSayToolPart(part: unknown): boolean {
  const p = part as SayToolPartLike;
  if (p?.type === "tool-say") return true;
  return p?.type === "dynamic-tool" && p.toolName === "say";
}

/**
 * The words a `say` part carries, or null while its input is still streaming,
 * when the call was refused, or when it carries none: a call with nothing to
 * say draws nothing.
 */
export function sayToolText(part: unknown): string | null {
  if (!isSayToolPart(part)) return null;
  const p = part as SayToolPartLike;
  if (!SAID_STATES.has(p.state ?? "")) return null;
  const input = p.input as { text?: unknown } | undefined;
  const text = typeof input?.text === "string" ? input.text : "";
  return text.trim() === "" ? null : text;
}

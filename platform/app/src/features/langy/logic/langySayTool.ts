/**
 * The `say` TOOL is a line of Langy's own words, drawn where the call happened.
 *
 * A model that writes its reply once its calls are done puts every line at the
 * end of the turn, under the cards. The worker's `say` tool gives a line a
 * place of its own: the call arrives as `tool-say` (or `dynamic-tool` named
 * `say`) carrying `{ text }`, is streamed, recorded and replayed in the order
 * it happened, and the panel draws its text as ordinary reply prose. It is
 * never an activity row, never a card, and never collapsed into the receipt.
 *
 * Pure and JSX-free: `langyTranscriptRuns` sorts these parts into their own
 * run, `MessageContent` draws that run as prose, and `LangyToolActivity`
 * leaves the part out of the activity spine.
 */

interface SayToolPartLike {
  type?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
}

/**
 * States whose `input` is COMPLETE. While the call is still streaming its
 * input the text may be half a sentence; nothing renders from that.
 */
const COMPLETE_INPUT_STATES = new Set([
  "input-available",
  "output-available",
  "output-error",
  "output-denied",
]);

/** Is this part the agent's `say` tool call? */
export function isSayToolPart(part: unknown): boolean {
  const p = part as SayToolPartLike;
  if (p?.type === "tool-say") return true;
  return p?.type === "dynamic-tool" && p.toolName === "say";
}

/**
 * The words a `say` part carries, or null while its input is still streaming
 * or when it carries none: a call with nothing to say draws nothing.
 */
export function sayToolText(part: unknown): string | null {
  if (!isSayToolPart(part)) return null;
  const p = part as SayToolPartLike;
  if (!COMPLETE_INPUT_STATES.has(p.state ?? "")) return null;
  const input = p.input as { text?: unknown } | undefined;
  const text = typeof input?.text === "string" ? input.text : "";
  return text.trim() === "" ? null : text;
}

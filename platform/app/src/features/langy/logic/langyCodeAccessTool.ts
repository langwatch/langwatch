/**
 * The `code_access` TOOL is the code access card (ADR-129) — this module is
 * the bridge, the same shape `langyQuestionTool` takes for the question tool.
 *
 * Langy calls `code_access` before the first change to the customer's own
 * program. The tool answers itself when a folder is already connected or the
 * user remembered GitHub; otherwise it records a control request and ends the
 * turn on the card. Either way the CALL is what the panel sees, so the call is
 * where the card hangs.
 *
 * The card's STATE is never read from the tool part: the folder can connect
 * after the turn settles, and the remembered choice can be cleared from the
 * settings page. `langy.getLocalWorkspace` is the one source, refetched when a
 * `local_workspace` entry says the folder came or went.
 *
 * Pure and JSX-free.
 */
export const LANGY_CODE_ACCESS_TOOL_NAME = "code_access";

interface CodeAccessPartLike {
  type?: string;
  toolName?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
}

/**
 * The first words of the answer a call gets when it RAISED the card.
 *
 * `code_access` answers itself whenever it can: a folder that is already
 * connected comes back as the workspace facts, and a remembered GitHub choice
 * comes back as one line about GitHub. Neither asked the reader anything, and a
 * card for one of them repeated a connect the chip and the first card already
 * carried, at the bottom of the transcript, after the pull request. Langy calls
 * the tool once per stretch of work, so a long turn drew that card three times.
 *
 * The words are the worker's, in
 * `services/langyworker/src/tools/local-workspace.ts`, and a test on each side
 * pins them.
 */
export const LANGY_CODE_ACCESS_CARD_ANSWER =
  "The code access card is shown to the user.";

/**
 * States whose `input` is COMPLETE. A call still streaming its input has not
 * asked anything yet, and the card would flash in before the ask exists.
 */
const COMPLETE_INPUT_STATES = new Set([
  "input-available",
  "output-available",
  "output-error",
  "output-denied",
]);

/** Is this part Langy's `code_access` tool call? */
export function isCodeAccessToolPart(part: unknown): boolean {
  const p = part as CodeAccessPartLike;
  if (p?.type === `tool-${LANGY_CODE_ACCESS_TOOL_NAME}`) return true;
  return (
    p?.type === "dynamic-tool" && p.toolName === LANGY_CODE_ACCESS_TOOL_NAME
  );
}

/**
 * The id of the LAST `code_access` call in a message, or null when it asked
 * for none. The last one wins because a turn that asks twice is asking the
 * same question again, and two cards would offer two answers to it.
 */
export function codeAccessCallId(parts: readonly unknown[]): string | null {
  let found: string | null = null;
  for (const part of parts) {
    if (!isCodeAccessToolPart(part)) continue;
    const p = part as CodeAccessPartLike;
    if (!COMPLETE_INPUT_STATES.has(p.state ?? "")) continue;
    if (!codeAccessAsked(p)) continue;
    found = p.toolCallId ?? found ?? LANGY_CODE_ACCESS_TOOL_NAME;
  }
  return found;
}

/**
 * Whether one `code_access` call put the card up.
 *
 * A call whose answer has not landed yet counts as asking: the card belongs on
 * screen while the tool is deciding, and the first ask is the one the reader is
 * waiting on. A call that answered itself carries that answer, and the answer
 * is what says it asked nothing.
 */
function codeAccessAsked(part: CodeAccessPartLike): boolean {
  const output = part.output;
  if (typeof output !== "string" || output === "") return true;
  return output.startsWith(LANGY_CODE_ACCESS_CARD_ANSWER);
}

/**
 * The id of the LAST `code_access` call in a whole conversation, or null when
 * no message carries one.
 *
 * Only that card is live. Every state the card shows is read from the one
 * workspace query, so an older ask renders exactly what the newest one does:
 * two identical cards, two ways to answer the same question, and a click on
 * the older one answering a call the turn has moved past.
 */
export function latestCodeAccessCallId(
  messages: readonly { role?: string; parts?: readonly unknown[] }[],
): string | null {
  let found: string | null = null;
  for (const message of messages) {
    if (message?.role === "user") continue;
    const id = codeAccessCallId(message?.parts ?? []);
    if (id) found = id;
  }
  return found;
}

/** The one line Langy gave for the change it wants to make, when it gave one. */
export function codeAccessReason(parts: readonly unknown[]): string | null {
  for (const part of parts) {
    if (!isCodeAccessToolPart(part)) continue;
    const input = (part as CodeAccessPartLike).input as
      | { reason?: unknown }
      | undefined;
    if (typeof input?.reason === "string" && input.reason.trim() !== "") {
      return input.reason.trim();
    }
  }
  return null;
}

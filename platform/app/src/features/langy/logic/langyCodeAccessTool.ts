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
}

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
    found = p.toolCallId ?? found ?? LANGY_CODE_ACCESS_TOOL_NAME;
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

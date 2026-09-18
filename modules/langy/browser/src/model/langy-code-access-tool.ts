/**
 * The `code_access` tool is the code access card (ADR-129); this module is the bridge, the same
 * shape `langyQuestionTool` takes. State is never read from the tool part — the folder or the
 * remembered choice can change after the turn settles — so `langy.getLocalWorkspace` is the source.
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
 * The first words of the answer a call gets when it raised the card. Owned by
 * `services/langyworker/src/tools/local-workspace.ts`, pinned by a test on each side.
 */
export const LANGY_CODE_ACCESS_CARD_ANSWER = "The code access card is shown to the user.";

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
  return p?.type === "dynamic-tool" && p.toolName === LANGY_CODE_ACCESS_TOOL_NAME;
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
 * Whether one `code_access` call put the card up. A call whose answer hasn't landed counts as
 * asking; a call that answered itself carries that answer, which is what says it asked nothing.
 */
function codeAccessAsked(part: CodeAccessPartLike): boolean {
  const output = part.output;
  if (typeof output !== "string" || output === "") return true;
  return output.startsWith(LANGY_CODE_ACCESS_CARD_ANSWER);
}

/**
 * The id of the last `code_access` call in a whole conversation, or null when none. Only that
 * card is live, since state is read from the one workspace query — an older card would render
 * identically and answer a call the turn has moved past.
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
    const input = (part as CodeAccessPartLike).input as { reason?: unknown } | undefined;
    if (typeof input?.reason === "string" && input.reason.trim() !== "") {
      return input.reason.trim();
    }
  }
  return null;
}

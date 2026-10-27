import {
  isToolPart,
  saidTextOf,
  type LangyMessagePart,
  type LangyStreamEntry,
} from "@langwatch/langy-contract";

/** The tool call that puts the code access card up (ADR-129). */
const CODE_ACCESS_TOOL = "code_access";

/** The tool call that puts a question card up and settles the turn. */
const QUESTION_TOOL = "question";

/**
 * What the panel says when a turn finishes without the agent writing anything. Names the state
 * and hands the user their next move, rather than apologising for an internal detail they
 * cannot act on.
 */
export const LANGY_EMPTY_TURN_FALLBACK =
  "I finished this turn without writing a reply. Check the cards above for what ran before you ask again.";

const CODE_ACCESS_LINE =
  "I'm waiting for you to say how I should reach your code, on the card above.";

const QUESTION_LINE = "I'm waiting for your answer on the card above before I go on.";

const PERMISSION_LINE =
  "I'm waiting for your answer on the permission card above before I run that command.";

/**
 * The reply for a completed turn with no reply text, read back as message parts (REST result
 * path): the lines it said with `say`, else the line `langyEmptyTurnLine` gives for the card it
 * ended on. A question card settles the turn as completed, so it is named here too.
 */
export function langySilentTurnReplyFromParts(parts: readonly LangyMessagePart[]): string {
  const said = parts.map(saidTextOf).filter((text) => text.trim() !== "");
  if (said.length > 0) return said.join("\n\n");
  for (const part of [...parts].reverse()) {
    if (isToolPart(part, QUESTION_TOOL)) return QUESTION_LINE;
    if (isToolPart(part, CODE_ACCESS_TOOL)) return CODE_ACCESS_LINE;
  }
  return LANGY_EMPTY_TURN_FALLBACK;
}

/**
 * What the panel says when a turn ends on a card and nothing else. A turn that ends on a card
 * has not failed to answer: it is holding for the developer, and the card is the ask.
 */
export function langyEmptyTurnLine(entries: readonly LangyStreamEntry[]): string {
  for (const entry of [...entries].reverse()) {
    if (entry.type === "local_permission" && entry.status === "pending") {
      return PERMISSION_LINE;
    }
    if (entry.type === "question" && entry.status === "pending") {
      return QUESTION_LINE;
    }
    if (entry.type === "tool" && entry.name === CODE_ACCESS_TOOL) {
      return CODE_ACCESS_LINE;
    }
  }
  return LANGY_EMPTY_TURN_FALLBACK;
}

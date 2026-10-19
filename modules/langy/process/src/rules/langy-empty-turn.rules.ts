import type { LangyStreamEntry } from "@langwatch/langy-contract";

/** The tool call that puts the code access card up (ADR-129). */
const CODE_ACCESS_TOOL = "code_access";

/**
 * What the panel says when a turn finishes without the agent writing anything. Names the state
 * and hands the user their next move, rather than apologising for an internal detail they
 * cannot act on.
 */
export const LANGY_EMPTY_TURN_FALLBACK =
  "I finished this turn without writing a reply. Check the cards above for what ran before you ask again.";

const CODE_ACCESS_LINE =
  "I'm waiting for you to say how I should reach your code, on the card above.";

/**
 * The same line for a settled turn read back as message parts (REST result path), where the
 * code access card is a `tool-code_access` part rather than a stream entry.
 */
export function langyEmptyTurnLineFromParts(parts: readonly { type?: unknown }[]): string {
  return parts.some((part) => part.type === `tool-${CODE_ACCESS_TOOL}`)
    ? CODE_ACCESS_LINE
    : LANGY_EMPTY_TURN_FALLBACK;
}

/**
 * What the panel says when a turn ends on a card and nothing else. A turn that ends on a card
 * has not failed to answer: it is holding for the developer, and the card is the ask.
 */
export function langyEmptyTurnLine(entries: readonly LangyStreamEntry[]): string {
  for (const entry of [...entries].reverse()) {
    if (entry.type === "local_permission" && entry.status === "pending") {
      return "I'm waiting for your answer on the permission card above before I run that command.";
    }
    if (entry.type === "question" && entry.status === "pending") {
      return "I'm waiting for your answer on the card above before I go on.";
    }
    if (entry.type === "tool" && entry.name === CODE_ACCESS_TOOL) {
      return CODE_ACCESS_LINE;
    }
  }
  return LANGY_EMPTY_TURN_FALLBACK;
}

/**
 * The choices contract (ADR-060 §6) — the selection payload and the pure
 * lock-state derivation.
 *
 * A selection is an event and a message: the typed part binds by
 * `{ blockId, optionIds }` so adjacent questions can never misroute, and the
 * plain-text rendering rides beside it for the model to read.
 *
 * Whether a question is still answerable is EVENT ORDER and nothing else: a
 * choices card is open iff nothing follows it in the conversation. No
 * timers, no wall-clock state — the same derivation replays identically in
 * time travel, which is what makes the card's state honest forever.
 */
import * as z from "zod/v4";

/**
 * The structured half of an answer. `optionIds` carries the picked option(s)
 * (plural under `multiSelect`); `otherText` carries a free-text answer when
 * the card allowed one (`allowOther`). At least one of the two must say
 * something — an empty selection answers nothing.
 */
export const langyChoiceSelectionSchema = z
  .object({
    blockId: z.string().min(1),
    optionIds: z.array(z.string().min(1)).default([]),
    otherText: z.string().optional(),
  })
  .refine(
    (selection) =>
      selection.optionIds.length > 0 ||
      (selection.otherText !== undefined &&
        selection.otherText.trim().length > 0),
    { message: "a selection must pick an option or carry other-text" },
  );
export type LangyChoiceSelection = z.infer<typeof langyChoiceSelectionSchema>;

/**
 * One entry in the conversation's ordered timeline, as the caller flattens
 * it from the fold / message list:
 *
 *   - `question`  — a choices card appearing in an assistant message.
 *   - `selection` — a recorded answer part (a user message carrying the
 *                   typed selection).
 *   - `message`   — any other conversational exchange (an ordinary user
 *                   message, a later assistant answer).
 *
 * Order is the conversation's own event order. Nothing else is read.
 */
export type LangyChoicesTimelineEntry =
  | { kind: "question"; blockId: string }
  | {
      kind: "selection";
      blockId: string;
      optionIds: readonly string[];
      otherText?: string;
    }
  | { kind: "message" };

export type LangyChoicesLockState =
  | { status: "open" }
  | {
      status: "answered";
      optionIds: readonly string[];
      otherText?: string;
    }
  | { status: "superseded" };

/**
 * Derive a choices card's lock state from the ordered timeline.
 *
 *   - A recorded selection for the card, anywhere after it, marks it
 *     answered — an answered question shows its outcome forever, including
 *     through time travel.
 *   - Otherwise anything at all after the question supersedes it: a question
 *     is answerable only while it is the conversation's latest exchange.
 *   - Otherwise it is open.
 *
 * When the same blockId appears more than once (a replayed or re-emitted
 * question), the LAST occurrence is the question being asked.
 */
export function deriveLangyChoicesLockState({
  blockId,
  timeline,
}: {
  blockId: string;
  timeline: readonly LangyChoicesTimelineEntry[];
}): LangyChoicesLockState {
  let questionIndex = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const entry = timeline[i]!;
    if (entry.kind === "question" && entry.blockId === blockId) {
      questionIndex = i;
      break;
    }
  }
  // A question that is not on the timeline is not answerable — the caller is
  // asking about a card the conversation never recorded.
  if (questionIndex === -1) return { status: "superseded" };

  let sawLaterEntry = false;
  for (let i = questionIndex + 1; i < timeline.length; i++) {
    const entry = timeline[i]!;
    if (entry.kind === "selection" && entry.blockId === blockId) {
      return {
        status: "answered",
        optionIds: entry.optionIds,
        ...(entry.otherText !== undefined
          ? { otherText: entry.otherText }
          : {}),
      };
    }
    sawLaterEntry = true;
  }
  return sawLaterEntry ? { status: "superseded" } : { status: "open" };
}

/**
 * The plain-text rendering of a selection — what the model reads as the next
 * user message ("Chose: Staging agent"). The UI binds by id; the model just
 * reads words.
 */
export function renderLangyChoiceSelectionText({
  selection,
  optionLabelById,
}: {
  selection: LangyChoiceSelection;
  optionLabelById: ReadonlyMap<string, string>;
}): string {
  const labels = selection.optionIds.map(
    (id) => optionLabelById.get(id) ?? id,
  );
  if (selection.otherText !== undefined && selection.otherText.trim() !== "") {
    labels.push(selection.otherText.trim());
  }
  return `Chose: ${labels.join(", ")}`;
}

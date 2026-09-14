/**
 * Choices contract (ADR-060 §6): selection payload and lock-state derivation.
 * Answerable iff no later entry (event order only, no timers). See ADR-060.
 */
import * as z from "zod";

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
      (selection.otherText !== undefined && selection.otherText.trim().length > 0),
    { message: "a selection must pick an option or carry other-text" },
  );
export type LangyChoiceSelection = z.infer<typeof langyChoiceSelectionSchema>;

/**
 * Timeline entry: question (choices card), selection (answer), or message
 * (other exchange). Ordered by conversation event order.
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
 * Lock state from timeline: answered (has selection) > superseded (later
 * entry) > open. Last blockId occurrence is the question being asked.
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
        ...(entry.otherText !== undefined ? { otherText: entry.otherText } : {}),
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
  const labels = selection.optionIds.map((id) => optionLabelById.get(id) ?? id);
  if (selection.otherText !== undefined && selection.otherText.trim() !== "") {
    labels.push(selection.otherText.trim());
  }
  return `Chose: ${labels.join(", ")}`;
}

/**
 * Flatten the rendered conversation into the ordered timeline the choices
 * lock derivation reads (ADR-060 §6) — event order and NOTHING else. Because
 * it derives from whatever message list is being displayed, time travel gets
 * the right answer for free: scrub before the selection and the question is
 * open, scrub past it and the card is locked.
 *
 * Per message, in conversation order:
 *   - an assistant message contributes a `question` entry per choices block
 *     it carries (its OWN prose never supersedes its own question);
 *   - a user message carrying selection parts contributes those selections
 *     (its "Chose: X" text is part of the answer, not a second exchange);
 *   - any other message contributes one `message` entry.
 */
import {
  LANGY_CHOICE_SELECTION_PART_TYPE,
  type LangyChoicesTimelineEntry,
  parseLangyCardPart,
  parseLangyChoiceSelectionPart,
} from "@langwatch/langy";

import { langyAnswerSegmentsFromText } from "./langyAnswerSegments";
import { isQuestionToolPart, questionToolCardParts } from "./langyQuestionTool";

interface MessageLike {
  role: string;
  parts?: readonly unknown[];
  /** `{recorded: true}` marks a message read back from the durable fold. */
  metadata?: unknown;
}

/**
 * The choices blocks an UNSTAMPED assistant message renders — the copy this
 * browser streamed, whose fences the relay never got to stamp for it (see
 * `langyAnswerSegmentsFromText`). The timeline has to see exactly what the
 * renderer draws: a question the reader can see but that never reached the
 * timeline derives as "never recorded", so the card renders permanently
 * closed and the reader watches Langy ask a question it will not accept an
 * answer to.
 */
function streamedChoicesBlockIds(message: MessageLike): string[] {
  const recorded =
    (message.metadata as { recorded?: boolean } | undefined)?.recorded === true;
  if (recorded) return [];
  const text = (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");
  return (langyAnswerSegmentsFromText(text) ?? []).flatMap((segment) =>
    segment.type === "card" && segment.part.card.kind === "choices"
      ? [segment.part.blockId]
      : [],
  );
}

export function langyChoicesTimeline(
  messages: readonly MessageLike[],
): LangyChoicesTimelineEntry[] {
  const timeline: LangyChoicesTimelineEntry[] = [];

  for (const message of messages) {
    const parts = message.parts ?? [];

    if (message.role === "assistant") {
      let sawQuestion = false;
      for (const part of parts) {
        const card = parseLangyCardPart(part);
        if (card && card.card.kind === "choices") {
          timeline.push({ kind: "question", blockId: card.blockId });
          sawQuestion = true;
          continue;
        }
        // The agent's `question` TOOL asks the same way a choices block does
        // (see langyQuestionTool.ts) — its cards must appear on the timeline
        // or the lock derivation would call them "never recorded" and render
        // every one permanently closed.
        if (isQuestionToolPart(part)) {
          for (const questionCard of questionToolCardParts(part)) {
            timeline.push({ kind: "question", blockId: questionCard.blockId });
            sawQuestion = true;
          }
        }
      }
      if (!sawQuestion) {
        for (const blockId of streamedChoicesBlockIds(message)) {
          timeline.push({ kind: "question", blockId });
          sawQuestion = true;
        }
      }
      if (!sawQuestion) timeline.push({ kind: "message" });
      continue;
    }

    if (message.role === "user") {
      let sawSelection = false;
      for (const part of parts) {
        if (
          (part as { type?: string }).type !== LANGY_CHOICE_SELECTION_PART_TYPE
        ) {
          continue;
        }
        const selection = parseLangyChoiceSelectionPart(part);
        if (!selection) continue;
        timeline.push({
          kind: "selection",
          blockId: selection.blockId,
          optionIds: selection.optionIds,
          ...(selection.otherText !== undefined
            ? { otherText: selection.otherText }
            : {}),
        });
        sawSelection = true;
      }
      if (!sawSelection) timeline.push({ kind: "message" });
      continue;
    }

    timeline.push({ kind: "message" });
  }

  return timeline;
}

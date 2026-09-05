/**
 * Flatten the rendered conversation into the ordered timeline the choices lock
 * derivation reads (ADR-060 §6) — event order and NOTHING else.
 */
import {
  type LangyChoicesTimelineEntry,
  parseLangyCardPart,
  parseLangyChoiceSelectionPart,
} from "@langwatch/langy-contract";

import { langyAnswerSegmentsFromText } from "./langy-answer-segments";
import { isQuestionToolPart, questionToolCardParts } from "./langy-question-tool";

interface MessageLike {
  role: string;
  parts?: readonly unknown[];
  /** `{recorded: true}` marks a message read back from the durable fold. */
  metadata?: unknown;
}

/**
 * The choices blocks an UNSTAMPED assistant message renders — the copy this browser streamed, whose fences the relay never got to stamp for it (see `langyAnswerSegmentsFromText`).
 */
function pushQuestionToolCards(part: unknown, timeline: LangyChoicesTimelineEntry[]): boolean {
  let pushedAny = false;
  for (const questionCard of questionToolCardParts(part)) {
    timeline.push({ kind: "question", blockId: questionCard.blockId });
    pushedAny = true;
  }
  return pushedAny;
}

function streamedChoicesBlockIds(message: MessageLike): string[] {
  const recorded = (message.metadata as { recorded?: boolean } | undefined)?.recorded === true;
  if (recorded) return [];
  const text = (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");
  return (langyAnswerSegmentsFromText(text) ?? []).flatMap((segment) =>
    segment.type === "card" && segment.part.card.kind === "choices" ? [segment.part.blockId] : [],
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
        if (isQuestionToolPart(part) && pushQuestionToolCards(part, timeline)) {
          sawQuestion = true;
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
        const selection = parseLangyChoiceSelectionPart(part);
        if (!selection) continue;
        timeline.push({
          kind: "selection",
          blockId: selection.blockId,
          optionIds: selection.optionIds,
          ...(selection.otherText !== void 0 ? { otherText: selection.otherText } : {}),
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

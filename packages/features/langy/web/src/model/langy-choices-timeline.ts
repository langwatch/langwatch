/**
 * Flattens the rendered conversation into the ordered timeline the choices lock derivation reads
 * (ADR-060 §6), from message parts only (prose never carries a choices card), so time travel gets
 * the right answer for free by construction.
 */
import {
  type LangyChoicesTimelineEntry,
  parseLangyCardPart,
  parseLangyChoiceSelectionPart,
} from "@langwatch/langy-contract";

import { isQuestionToolPart, questionToolCardParts } from "./langy-question-tool.ts";

interface MessageLike {
  role: string;
  parts?: readonly unknown[];
  /** `{recorded: true}` marks a message read back from the durable fold. */
  metadata?: unknown;
}

/**
 * Every choices card one `question` tool call carries, pushed in the order it holds them.
 */
function pushQuestionToolCards(part: unknown, timeline: LangyChoicesTimelineEntry[]): boolean {
  let pushedAny = false;
  for (const questionCard of questionToolCardParts(part)) {
    timeline.push({ kind: "question", blockId: questionCard.blockId });
    pushedAny = true;
  }
  return pushedAny;
}

/** Every choices card (block or `question`-tool) an assistant message carries, in order. */
function pushAssistantChoicesCards(
  parts: readonly unknown[],
  timeline: LangyChoicesTimelineEntry[],
): boolean {
  let sawQuestion = false;
  for (const part of parts) {
    const card = parseLangyCardPart(part);
    if (card && card.card.kind === "choices") {
      timeline.push({ kind: "question", blockId: card.blockId });
      sawQuestion = true;
      continue;
    }
    // The agent's `question` TOOL asks the same way a choices block does (see
    // langyQuestionTool.ts) — its cards must appear on the timeline or the
    // lock derivation would call them "never recorded" and render every one
    // permanently closed.
    const pushedQuestionToolCards =
      isQuestionToolPart(part) && pushQuestionToolCards(part, timeline);
    if (pushedQuestionToolCards) {
      sawQuestion = true;
    }
  }
  return sawQuestion;
}

/** Every choice-selection reply a user message carries, in order. */
function pushUserSelections(
  parts: readonly unknown[],
  timeline: LangyChoicesTimelineEntry[],
): boolean {
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
  return sawSelection;
}

export function langyChoicesTimeline(
  messages: readonly MessageLike[],
): LangyChoicesTimelineEntry[] {
  const timeline: LangyChoicesTimelineEntry[] = [];

  for (const message of messages) {
    const parts = message.parts ?? [];

    if (message.role === "assistant") {
      if (!pushAssistantChoicesCards(parts, timeline)) timeline.push({ kind: "message" });
      continue;
    }

    if (message.role === "user") {
      if (!pushUserSelections(parts, timeline)) timeline.push({ kind: "message" });
      continue;
    }

    timeline.push({ kind: "message" });
  }

  return timeline;
}

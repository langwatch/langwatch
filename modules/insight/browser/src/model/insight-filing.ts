/**
 * What "Save as insight" files from a Langy answer: a draft the person may still edit, and
 * the pointer, the query and the window the answer was about. Pure. A finding of an insights
 * card is read as typed data; an answer with no card is read from its prose and its subject.
 */

import {
  type ActionableInsightTone,
  DEFAULT_INSIGHT_VALID_DAYS,
  type FileInsightInput,
  insightReplaySchema,
  isActionableTone,
} from "@langwatch/insight-contract";
import type {
  LangyAnswerSubject,
  LangyDerivedInsightsCard,
  LangyInsightsCardFinding,
} from "@langwatch/langy-contract";

import { titleFromAnswer } from "./insight-presentation.ts";

/** The words the save form starts with; a new insight names a next step, so never `good`. */
export type InsightDraft = {
  title: string;
  body: string;
  tone: ActionableInsightTone;
  topic: string;
  validDays: number;
};

/** Where the answer came from, as a filing keeps it. */
type FiledOrigin = Pick<FileInsightInput, "board" | "lwql" | "replay">;

/** An answer with no card: its first line as the title, its prose as the body. */
export function draftOfAnswer(answerText: string): InsightDraft {
  return {
    title: titleFromAnswer(answerText),
    body: answerText,
    tone: "watch",
    topic: "",
    validDays: DEFAULT_INSIGHT_VALID_DAYS,
  };
}

/**
 * One finding of an answer's insights card, word for word. An older card's good news starts as
 * Check this: a new insight names a next step.
 */
export function draftOfFinding(finding: LangyInsightsCardFinding): InsightDraft {
  return {
    title: finding.title,
    body: finding.body,
    tone: isActionableTone(finding.tone) ? finding.tone : "watch",
    topic: finding.topic ?? "",
    validDays: finding.validDays ?? DEFAULT_INSIGHT_VALID_DAYS,
  };
}

/** What the answer was about, as the asking module said it: the pointer, the query, its window. */
export function filedSubject(subject: LangyAnswerSubject | undefined): FiledOrigin {
  const { board, evidence } = subject ?? {};
  return {
    ...(board ? { board: { id: board.id, name: board.name, widget: board.widget ?? null } } : {}),
    ...(evidence
      ? {
          lwql: evidence.lwql,
          replay: {
            ...evidence.window,
            period: evidence.period ?? null,
            parameters: { ...evidence.parameters },
          },
        }
      : {}),
  };
}

/**
 * What a card's finding came from: the card's board with the finding's widget, the finding's
 * query, and the card's window when it is one a replay takes. Only a pointer and what to run.
 */
export function filedFinding({
  card,
  finding,
}: {
  card: Pick<LangyDerivedInsightsCard, "board" | "window">;
  finding: LangyInsightsCardFinding;
}): FiledOrigin {
  const { widgetId, widgetName, lwql } = finding;
  const widget = widgetId && widgetName ? { id: widgetId, name: widgetName } : null;
  const replay = insightReplaySchema.safeParse({ ...card.window, period: null, parameters: {} });
  return {
    ...(card.board ? { board: { ...card.board, widget } } : {}),
    ...(lwql ? { lwql } : {}),
    ...(lwql && replay.success ? { replay: replay.data } : {}),
  };
}

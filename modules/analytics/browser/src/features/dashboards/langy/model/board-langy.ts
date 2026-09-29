/**
 * What a board tells Langy: the self-describing context a question rides with
 * (AC16): which board, what is on it and the period it reads over. Pure.
 */

import { Temporal } from "@langwatch/time";

import type {
  AnalyticsLangyAskRequest,
  AnalyticsLangyContext,
} from "../../../../model/analytics-host.ts";
import type { BoardPeriod } from "../../model/board-period.ts";

/** The rollout flag that gives a project Langy at all. */
export const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** An ask starts a conversation, which is what this permission allows. */
export const LANGY_ASK_PERMISSION = "langy:create";

/** Langy's own bounds on a context reference and its label. */
const MAX_REF_LENGTH = 4_000;
const MAX_LABEL_LENGTH = 200;

/** The board a question is asked from: the open one, and the widgets on it now. */
export interface BoardSubject {
  readonly id: string;
  readonly name: string;
  readonly widgetNames: readonly string[];
}

/** The open board as Langy's subject. */
export function boardSubject({
  board,
  widgets,
}: {
  board: { id: string; name: string };
  widgets: readonly { name: string }[];
}): BoardSubject {
  return { id: board.id, name: board.name, widgetNames: widgets.map(({ name }) => name) };
}

function periodText(period: BoardPeriod): string {
  const instant = (epochMs: number) => Temporal.Instant.fromEpochMilliseconds(epochMs).toString();
  return `${instant(period.periodStart)} to ${instant(period.periodEnd)}`;
}

const GRAIN_UNITS = [
  { unit: "week", seconds: 604_800 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
] as const;

function grainText(granularitySeconds: number): string {
  const found = GRAIN_UNITS.find(({ seconds }) => granularitySeconds % seconds === 0);
  if (!found) return `${granularitySeconds} seconds`;
  const count = granularitySeconds / found.seconds;
  return count === 1 ? `1 ${found.unit}` : `${count} ${found.unit}s`;
}

function context({ ref, label }: { ref: string; label: string }): AnalyticsLangyContext {
  return {
    kind: "dashboard",
    ref: ref.slice(0, MAX_REF_LENGTH),
    label: label.slice(0, MAX_LABEL_LENGTH),
  };
}

/** The board as the agent reads it: which one, what is on it, over when. */
export function boardAskContext({
  board,
  period,
}: {
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyContext {
  const widgets = board.widgetNames.length > 0 ? board.widgetNames.join(", ") : "none yet";
  return context({
    ref: [
      `dashboard "${board.name}" (id ${board.id})`,
      `widgets: ${widgets}`,
      `period: ${periodText(period)}`,
    ].join("; "),
    label: board.name,
  });
}

/** A typed question, asked with the board attached. */
export function boardQuestion({
  question,
  board,
  period,
}: {
  question: string;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return { question: question.trim(), context: [boardAskContext({ board, period })] };
}

/** A picker question's prompt with the board's concrete window and grain appended. */
function promptWithWindow({ prompt, period }: { prompt: string; period: BoardPeriod }): string {
  const window =
    `Dashboard period: ${periodText(period)} (UTC). ` +
    `Dashboard grain: one bucket per ${grainText(period.granularitySeconds)}.`;
  return `${prompt}\n\n${window}`;
}

/** A picker question's prompt, asked with the board and its concrete window and grain. */
export function boardPromptQuestion({
  prompt,
  board,
  period,
}: {
  prompt: string;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return boardQuestion({ question: promptWithWindow({ prompt, period }), board, period });
}

/**
 * The same prompt as `boardPromptQuestion`, handed over as a composer draft
 * rather than sent: the reader adds the block, then reads and sends it (AC12).
 */
export function boardPromptDraft({
  prompt,
  board,
  period,
}: {
  prompt: string;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return {
    draft: promptWithWindow({ prompt, period }),
    context: [boardAskContext({ board, period })],
  };
}

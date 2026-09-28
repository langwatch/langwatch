/**
 * What a board tells Langy: the self-describing context a question rides with
 * (AC16), and the insights request for one block, carrying the numbers its own
 * query returned so the answer can quote them (AC17). Pure.
 */

import { Temporal } from "@langwatch/time";

import type {
  AnalyticsLangyAskRequest,
  AnalyticsLangyContext,
} from "../../../../model/analytics-host.ts";
import { type BlockDefinition, type BlockPeriod, FLIGHT_DECK_BLOCKS } from "../../blocks/index.ts";
import type { BlockRows } from "../../blocks/model/block-format.ts";
import type { BoardBlock } from "../../model/board-blocks.ts";
import { FLIGHT_DECK } from "../../model/boards.ts";

/** The rollout flag that gives a project Langy at all. */
export const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** An ask starts a conversation, which is what this permission allows. */
export const LANGY_ASK_PERMISSION = "langy:create";

/** Langy's own bounds on a context reference and its label. */
const MAX_REF_LENGTH = 4_000;
const MAX_LABEL_LENGTH = 200;

/** Rows per statement handed over; enough for a period's buckets, bounded for the prompt. */
const MAX_ROWS_PER_STATEMENT = 60;

/** The board a question is asked from. */
export interface BoardSubject {
  readonly id: string;
  readonly name: string;
  /** The code-defined Flight Deck: Langy may suggest changes only for the member's own boards. */
  readonly readOnly: boolean;
  readonly blockTitles: readonly string[];
}

/** The Agent Flight Deck, which a question may be about but a change never lands on. */
export const FLIGHT_DECK_SUBJECT: BoardSubject = {
  id: FLIGHT_DECK.id,
  name: FLIGHT_DECK.name,
  readOnly: true,
  blockTitles: FLIGHT_DECK_BLOCKS.map(({ title }) => title),
};

/** One of the member's own boards, with the blocks on it now. */
export function ownBoardSubject({
  board,
  blocks,
}: {
  board: { id: string; name: string };
  blocks: readonly BoardBlock[];
}): BoardSubject {
  return {
    id: board.id,
    name: board.name,
    readOnly: false,
    blockTitles: blocks.map(({ block }) => block.title),
  };
}

function periodText(period: BlockPeriod): string {
  const instant = (epochMs: number) => Temporal.Instant.fromEpochMilliseconds(epochMs).toString();
  return `${instant(period.periodStart)} to ${instant(period.periodEnd)}`;
}

function context({ ref, label }: { ref: string; label: string }): AnalyticsLangyContext {
  return {
    kind: "dashboard",
    ref: ref.slice(0, MAX_REF_LENGTH),
    label: label.slice(0, MAX_LABEL_LENGTH),
  };
}

/** The board as the agent reads it: which one, whether it may change, what is on it, over when. */
export function boardAskContext({
  board,
  period,
}: {
  board: BoardSubject;
  period: BlockPeriod;
}): AnalyticsLangyContext {
  const standing = board.readOnly
    ? "built in and read-only; any change goes on one of the member's own dashboards, never this one"
    : "the member's own dashboard";
  const blocks = board.blockTitles.length > 0 ? board.blockTitles.join(", ") : "none yet";
  return context({
    ref: [
      `dashboard "${board.name}" (id ${board.id})`,
      standing,
      `blocks: ${blocks}`,
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
  period: BlockPeriod;
}): AnalyticsLangyAskRequest {
  return { question: question.trim(), context: [boardAskContext({ board, period })] };
}

function cellText(value: unknown): string {
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A block's result as text: each statement's rows, each row's columns with their values. */
export function blockResultDigest(rows: BlockRows): string {
  return Object.entries(rows)
    .map(([statement, statementRows]) => {
      const listed = statementRows.slice(0, MAX_ROWS_PER_STATEMENT).map((row) =>
        Object.entries(row)
          .map(([column, value]) => `${column}=${cellText(value)}`)
          .join(", "),
      );
      return `${statement}: ${listed.length > 0 ? listed.join(" | ") : "no rows"}`;
    })
    .join("; ");
}

/** "Generate insights" on one block: the question, and the block's own result to quote from. */
export function blockInsightsRequest({
  boardName,
  block,
  rows,
  period,
}: {
  boardName: string;
  block: Pick<BlockDefinition, "title" | "subtitle">;
  rows: BlockRows;
  period: BlockPeriod;
}): AnalyticsLangyAskRequest {
  return {
    question:
      `Generate insights on "${block.title}": what stands out, what changed across ` +
      "the period, and what to look at next. Quote the numbers from its result.",
    context: [
      context({
        ref: [
          `block "${block.title}" (${block.subtitle}) on dashboard "${boardName}"`,
          `period: ${periodText(period)}`,
          `result: ${blockResultDigest(rows)}`,
        ].join("; "),
        label: block.title,
      }),
    ],
  };
}

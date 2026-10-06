/**
 * What a board tells Langy: the self-describing context a question rides with
 * (AC16): which board, what is on it and the period it reads over, and the drafts
 * about the board or one widget on it (AC120, AC140, AC142). Pure.
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

/** A prompt with the board's concrete window and grain appended. */
function promptWithWindow({ prompt, period }: { prompt: string; period: BoardPeriod }): string {
  const window =
    `Dashboard period: ${periodText(period)} (UTC). ` +
    `Dashboard grain: one bucket per ${grainText(period.granularitySeconds)}.`;
  return `${prompt}\n\n${window}`;
}

/**
 * A prompt about the whole board, such as a template's report (AC140), handed over as a
 * composer draft rather than sent: the reader reads and sends it.
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

/**
 * Langy's composer declares no length, so a widget draft keeps itself readable: long
 * LangWatchQL is cut to share what room is left under this bound between the queries.
 */
export const MAX_WIDGET_DRAFT_LENGTH = 6_000;

/** A widget as a draft reads it: its name and the stored parts that explain it. */
export interface WidgetSubject {
  readonly name: string;
  readonly definition: {
    readonly prompt?: string;
    readonly description?: string;
    readonly queries: readonly { readonly name: string; readonly sql: string }[];
  };
}

/** Older and Langy-made widgets store no prompt, so ask the widget's own question. */
function fallbackPrompt(name: string): string {
  return (
    `Answer "${name}" for this dashboard widget, using its queries below over the ` +
    "dashboard period at the dashboard grain. Quote the real numbers from the query " +
    "results. If a query returns no rows, say plainly that there is no data for the " +
    "dashboard period rather than guessing."
  );
}

function truncated({ sql, room }: { sql: string; room: number }): string {
  if (sql.length <= room) return sql;
  const marker = (cut: number) => `\n-- [truncated: ${cut} more characters]`;
  const kept = Math.max(room - marker(sql.length).length, 0);
  return `${sql.slice(0, kept)}${marker(sql.length - kept)}`;
}

/** Each query's SQL within `room` in all: short ones whole, the rest share what is left. */
function fittedSql({ sqls, room }: { sqls: readonly string[]; room: number }): string[] {
  const byLength = sqls
    .map((sql, index) => ({ sql, index }))
    .toSorted((a, b) => a.sql.length - b.sql.length);
  const fitted: string[] = [];
  let left = room;
  for (const [position, { sql, index }] of byLength.entries()) {
    const share = Math.floor(left / (byLength.length - position));
    fitted[index] = truncated({ sql, room: share });
    left -= Math.min(sql.length, share);
  }
  return fitted;
}

function widgetBlock({ widget, sqls }: { widget: WidgetSubject; sqls: readonly string[] }) {
  const { description, queries } = widget.definition;
  return [
    "This widget:",
    `Name: ${widget.name}`,
    ...(description ? [`Description: ${description}`] : []),
    ...(queries.length > 0 ? ["Queries (LangWatchQL):"] : []),
    ...queries.map(({ name }, index) => `- ${name}:\n${sqls[index] ?? ""}`),
  ].join("\n");
}

/**
 * One widget's prompt as a composer draft, as picking a widget gives (AC121): its prompt
 * or a fallback, its name, description and queries, then the board's window. Langy has
 * no widget context kind, so the widget rides in the text beside the board context.
 */
export function widgetPromptDraft({
  widget,
  board,
  period,
}: {
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return widgetDraft({
    prompt: widget.definition.prompt ?? fallbackPrompt(widget.name),
    widget,
    board,
    period,
  });
}

/** What a widget's menu asks Langy to set up on it, beside asking about it. */
export type WidgetSetup = "alert" | "report";

/**
 * The automation drawer's graph alerts and reports read builder graphs only, so a stored
 * widget is set up through Langy, which can read its queries.
 */
const SETUP_PROMPTS: Readonly<Record<WidgetSetup, (name: string) => string>> = {
  alert: (name) =>
    `Set up an alert on my "${name}" dashboard widget. Ask me which number to watch, the ` +
    "threshold and where to send the alert (Slack, email or webhook), then create it in " +
    "LangWatch. Base it on the widget's queries below.",
  report: (name) =>
    `Send my "${name}" dashboard widget as a scheduled report. Ask me how often and where ` +
    "to send it (Slack, email or webhook), then set the report up in LangWatch. Base it on " +
    "the widget's queries below.",
};

/** A widget menu action as a composer draft (AC142, AC143): what to set up, then the widget. */
export function widgetSetupDraft({
  setup,
  widget,
  board,
  period,
}: {
  setup: WidgetSetup;
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return widgetDraft({ prompt: SETUP_PROMPTS[setup](widget.name), widget, board, period });
}

function widgetDraft({
  prompt,
  widget,
  board,
  period,
}: {
  prompt: string;
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const draftWith = (sqls: readonly string[]) =>
    promptWithWindow({ prompt: `${prompt}\n\n${widgetBlock({ widget, sqls })}`, period });
  const sqls = widget.definition.queries.map(({ sql }) => sql);
  const room = MAX_WIDGET_DRAFT_LENGTH - draftWith([]).length;
  return {
    draft: draftWith(fittedSql({ sqls, room })),
    context: [boardAskContext({ board, period })],
  };
}

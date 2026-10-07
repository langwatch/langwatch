/**
 * What a board tells Langy: the self-describing context a question rides with (AC16): which
 * board, what is on it and the period it reads over, and the drafts about the board or one
 * widget on it (AC120, AC140, AC142), including those from the widget editor. Pure.
 */

import { Temporal } from "@langwatch/time";

import type {
  AnalyticsLangyAskRequest,
  AnalyticsLangyContext,
  AnalyticsLangyDraftAbout,
} from "../../../../model/analytics-host.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { WidgetShape } from "../../model/widget-shape.ts";

/** The rollout flag that gives a project Langy at all. */
export const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** An ask starts a conversation, which is what this permission allows. */
export const LANGY_ASK_PERMISSION = "langy:create";

/** The questions an empty board suggests, short enough to sit on one line under the bar. */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "Where does my money go?",
  "What changed this week?",
  "What needs attention?",
  "Is quality holding?",
];

/** Langy's own bounds on a context reference and its label. */
const MAX_REF_LENGTH = 4_000;
const MAX_LABEL_LENGTH = 200;

/** The board a question is asked from: the open one, and the widgets on it now. */
export interface BoardSubject {
  /** The stored board's id, or the From LangWatch board's address for a template. */
  readonly id: string;
  readonly name: string;
  readonly widgetNames: readonly string[];
  /** Set on a From LangWatch board: a live template, read-only and never stored. */
  readonly templateId?: string;
}

/** The open board as Langy's subject. */
export function boardSubject({
  board,
  widgets,
}: {
  board: { id: string; name: string; templateId?: string };
  widgets: readonly { name: string }[];
}): BoardSubject {
  return {
    id: board.id,
    name: board.name,
    widgetNames: widgets.map(({ name }) => name),
    ...(board.templateId === void 0 ? {} : { templateId: board.templateId }),
  };
}

/** What a draft about this board is scoped to: the board, as it says it is on screen. */
export function boardDraftAbout(board: Pick<BoardSubject, "id">): AnalyticsLangyDraftAbout {
  return { ref: board.id };
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
  const which =
    board.templateId === void 0
      ? `dashboard "${board.name}" (id ${board.id})`
      : `From LangWatch dashboard "${board.name}" (template ${board.templateId}, read-only, not stored)`;
  return context({
    ref: [which, `widgets: ${widgets}`, `period: ${periodText(period)}`].join("; "),
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
    about: boardDraftAbout(board),
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

/**
 * "Ask Langy to help" on a widget whose traces lack a field it reads: how to start sending
 * it. Drafted from the board, so it is about the board, as the other card actions are.
 */
export function widgetMissingDataDraft({
  missing,
  widget,
  board,
  period,
}: {
  missing: { field: string; label: string };
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const prompt =
    `Help me send ${missing.label} on my traces. "${widget.name}" needs it (the ` +
    `${missing.field} field), and my traces do not have it yet. Explain in plain words what ` +
    "it is, how I start sending it from my agent, and what the widget will show once it arrives.";
  return widgetDraft({ prompt, widget, board, period });
}

/** What a draft from the editor is about when the editor is open on a widget not saved yet. */
export const NEW_WIDGET_REF = "new";

/** The widget open in the editor: a saved one has its id, a new one has none yet. */
export type EditedWidget = WidgetSubject & { readonly id?: string };

/** What a draft from the editor is about: the board, and the widget open in the editor. */
export function widgetDraftAbout({
  board,
  widget,
}: {
  board: Pick<BoardSubject, "id">;
  widget: Pick<EditedWidget, "id">;
}): AnalyticsLangyDraftAbout {
  return { ref: board.id, itemRef: widget.id ?? NEW_WIDGET_REF };
}

/** The widget being edited as the agent reads it: which one, on which board, over when. */
export function widgetEditorContext({
  widget,
  board,
  period,
}: {
  widget: EditedWidget;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyContext {
  const which =
    widget.id === void 0
      ? `new widget "${widget.name}", not saved yet`
      : `widget "${widget.name}" (id ${widget.id})`;
  return context({
    ref: `${which}, open in the editor on ${boardAskContext({ board, period }).ref}`,
    label: widget.name,
  });
}

/** Langy beside the editor, with the widget attached and nothing drafted ("Edit code"). */
export function widgetEditorOpened({
  widget,
  board,
  period,
}: {
  widget: EditedWidget;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return { context: [widgetEditorContext({ widget, board, period })] };
}

/** "Edit with Langy": Langy asks what the widget should show, then proposes and saves it. */
export function widgetEditDraft({
  widget,
  board,
  period,
}: {
  widget: EditedWidget;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const prompt =
    `Edit "${widget.name}" with me. Ask what I want it to show, propose the change to its ` +
    "code and queries, and save it only when I agree.";
  return editorDraft({ prompt, widget, board, period });
}

/** One change Langy suggests beside the editor, and why it helps. */
export interface WidgetAsk {
  readonly ask: string;
  readonly why: string;
}

/** Starting points for a new widget, then changes that fit what a widget draws. */
const WIDGET_ASKS: Readonly<Record<WidgetShape | "new", readonly WidgetAsk[]>> = {
  new: [
    { ask: "Show daily cost by model", why: "A bar per day, one colour per model." },
    { ask: "Show errors per day by type", why: "See which error grew." },
    { ask: "Show my slowest steps this week", why: "Find where the time goes." },
  ],
  line: [
    { ask: "Change this to a weekly view", why: "One bucket per week instead of per day." },
    { ask: "Split it by model", why: "One series per model." },
  ],
  bars: [
    { ask: "Show the top 10", why: "Keep the ten largest, fold the rest." },
    { ask: "Group by topic", why: "One row per topic instead." },
    { ask: "Show what changed since last period", why: "Add each row's change." },
  ],
  tile: [
    { ask: "Compare with last period", why: "Show the change beside the figure." },
    { ask: "Show the trend behind it", why: "Add a small line over the period." },
  ],
};

/** What Langy suggests in the editor: starting points for a new widget, else what fits it. */
export function widgetAsks(shape: WidgetShape | "new"): readonly WidgetAsk[] {
  return WIDGET_ASKS[shape];
}

/** A suggestion picked in the editor, drafted for the reader to send. */
export function widgetAskDraft({
  ask,
  widget,
  board,
  period,
}: {
  ask: WidgetAsk;
  widget: EditedWidget;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const prompt =
    widget.id === void 0
      ? `${ask.ask}. Build it as a new widget on this dashboard: write its code and ` +
        "LangWatchQL queries, and save it only when I agree."
      : `For "${widget.name}": ${ask.ask}. Propose the change to its code and queries, and ` +
        "save it only when I agree.";
  return editorDraft({ prompt, widget, board, period });
}

/** A draft from the editor: about the widget open in it, with that widget attached. */
function editorDraft({
  prompt,
  widget,
  board,
  period,
}: {
  prompt: string;
  widget: EditedWidget;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return widgetDraft({
    prompt,
    widget,
    board,
    period,
    about: widgetDraftAbout({ board, widget }),
    attached: widgetEditorContext({ widget, board, period }),
  });
}

function widgetDraft({
  prompt,
  widget,
  board,
  period,
  about = boardDraftAbout(board),
  attached = boardAskContext({ board, period }),
}: {
  prompt: string;
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
  about?: AnalyticsLangyDraftAbout;
  /** What rides with the draft: the board, or the widget open in the editor. */
  attached?: AnalyticsLangyContext;
}): AnalyticsLangyAskRequest {
  const draftWith = (sqls: readonly string[]) =>
    promptWithWindow({ prompt: `${prompt}\n\n${widgetBlock({ widget, sqls })}`, period });
  const sqls = widget.definition.queries.map(({ sql }) => sql);
  const room = MAX_WIDGET_DRAFT_LENGTH - draftWith([]).length;
  return { draft: draftWith(fittedSql({ sqls, room })), about, context: [attached] };
}

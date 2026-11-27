/**
 * What a board tells Langy: the self-describing context a question rides with (AC16): which
 * board, what is on it and the period it reads over, and the drafts about the board or one
 * widget on it (AC120, AC140, AC142), and the editor's starting prompt. Pure.
 */

import type { ChartAskSubject } from "@langwatch/analytics-contract/chart-frame-protocol";
import { type LangyContextChip, LANGY_WIDGET_CHIP_LABEL_PREFIX } from "@langwatch/langy-contract";
import { Temporal } from "@langwatch/time";

import type {
  AnalyticsLangyAskRequest,
  AnalyticsLangyContext,
  AnalyticsLangyDraftAbout,
} from "../../../../model/analytics-host.ts";
import {
  type BoardPeriod,
  type BoardPeriodRange,
  boardCustomInShort,
  boardPeriodInWords,
  bucketInWords,
} from "../../model/board-period.ts";
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
  { unit: "week", short: "w", seconds: 604_800 },
  { unit: "day", short: "d", seconds: 86_400 },
  { unit: "hour", short: "h", seconds: 3_600 },
  { unit: "minute", short: "m", seconds: 60 },
] as const;

function grainText(granularitySeconds: number): string {
  const found = GRAIN_UNITS.find(({ seconds }) => granularitySeconds % seconds === 0);
  if (!found) return `${granularitySeconds} seconds`;
  const count = granularitySeconds / found.seconds;
  return count === 1 ? `1 ${found.unit}` : `${count} ${found.unit}s`;
}

/** The grain as the header control writes it: "1d", "5m". */
function shortGrainText(granularitySeconds: number): string {
  const found = GRAIN_UNITS.find(({ seconds }) => granularitySeconds % seconds === 0);
  if (!found) return `${granularitySeconds}s`;
  return `${granularitySeconds / found.seconds}${found.short}`;
}

function context({
  ref,
  label,
  key,
}: {
  ref: string;
  label: string;
  key: string;
}): AnalyticsLangyContext {
  return {
    kind: "dashboard",
    ref: ref.slice(0, MAX_REF_LENGTH),
    label: label.slice(0, MAX_LABEL_LENGTH),
    key: key.slice(0, MAX_REF_LENGTH),
  };
}

/** The board's key: the open board's chip id, so an ask about the board is that chip. */
function boardKey(board: Pick<BoardSubject, "id">): string {
  return `dashboard:${board.id}`;
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
      ? `dashboard ${JSON.stringify(board.name)} (id ${board.id})`
      : `From LangWatch dashboard "${board.name}" (template ${board.templateId}, read-only, not stored)`;
  return context({
    ref: [
      which,
      `widgets: ${widgets}`,
      `period: ${periodText(period)}, one bucket per ${grainText(period.granularitySeconds)}`,
    ].join("; "),
    label: board.name,
    key: boardKey(board),
  });
}

/**
 * The open board as Langy's chip: keyed like the route's chip, so it replaces that one; it
 * reads the period on screen ("30d · 1d") and hands over what a question about the board does.
 */
export function boardContextChip({
  board,
  range,
  period,
}: {
  board: BoardSubject;
  range: BoardPeriodRange;
  period: BoardPeriod;
}): LangyContextChip {
  const shown = `${rangeInShort({ range, period })} · ${shortGrainText(period.granularitySeconds)}`;
  return {
    id: boardKey(board),
    kind: "dashboard",
    label: `dashboard: ${board.name} · ${shown}`.slice(0, MAX_LABEL_LENGTH),
    ref: boardAskContext({ board, period }).ref,
  };
}

/** The range as the chip names it: "Live", "7d", or a custom window's dates. */
function rangeInShort({ range, period }: { range: BoardPeriodRange; period: BoardPeriod }) {
  if (range === "live") return "Live";
  if (range !== "custom") return range;
  return boardCustomInShort({ from: period.periodStart, to: period.periodEnd });
}

/** What a question from a stored board's ask bar asks for: the answer as a widget on it. */
export const BOARD_QUESTION_ANSWER =
  "asked from this dashboard's ask bar: answer by adding a widget that shows the answer to " +
  "this dashboard, then say the answer in a sentence";

/**
 * A typed question, asked with the board attached. On a stored board the answer is a widget
 * on it (AC264); a From LangWatch board is read-only, so there it is a reply.
 */
export function boardQuestion({
  question,
  board,
  period,
}: {
  question: string;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const attached = boardAskContext({ board, period });
  const asked =
    board.templateId === void 0
      ? context({
          ref: `${BOARD_QUESTION_ANSWER}; ${attached.ref}`,
          label: attached.label,
          key: boardKey(board),
        })
      : attached;
  return { question: question.trim(), context: [asked], askedFrom: boardKey(board) };
}

/** Opens Langy with the board attached and nothing asked, for the reader to write in. */
export function boardOpen({
  board,
  period,
}: {
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  return { context: [boardAskContext({ board, period })] };
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
    draft: prompt,
    about: boardDraftAbout(board),
    context: [boardAskContext({ board, period })],
  };
}

/** A widget as a draft reads it: its name and the stored parts that explain it. */
export interface WidgetSubject {
  /** The stored widget's id; a widget not stored yet goes by its name. */
  readonly id?: string;
  readonly name: string;
  readonly definition: {
    readonly prompt?: string;
    readonly description?: string;
    readonly queries: readonly { readonly name: string; readonly sql: string }[];
  };
}

function truncated({ sql, room }: { sql: string; room: number }): string {
  if (sql.length <= room) return sql;
  const marker = (cut: number) => ` -- [truncated: ${cut} more characters]`;
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

/**
 * The widget as Langy reads it, beside the visible draft: its description, how to answer it,
 * what was clicked, the period as instants and each query's LangWatchQL, cut to fit the
 * context's bound. The reader sees only its label; the draft stays in their words.
 */
export function widgetContext({
  widget,
  board,
  period,
  focus,
}: {
  widget: WidgetSubject;
  board: Pick<BoardSubject, "id">;
  period: BoardPeriod;
  /** What the draft is about within the widget, such as the clicked value. */
  focus?: string;
}): AnalyticsLangyContext {
  const { description, prompt, queries } = widget.definition;
  const ref = (sqls: readonly string[]) =>
    [
      `widget "${widget.name}"`,
      ...(description ? [`description: ${description}`] : []),
      ...(prompt ? [`how to answer it: ${prompt}`] : []),
      ...(focus ? [`clicked: ${focus}`] : []),
      `period: ${periodText(period)}, one bucket per ${grainText(period.granularitySeconds)}`,
      ...(queries.length > 0
        ? [
            `queries (LangWatchQL): ${queries
              .map(({ name }, index) => `${name}: ${sqls[index] ?? ""}`)
              .join(" | ")}`,
          ]
        : []),
    ].join("; ");
  // Whole, as the widget runs it: a literal's spaces and the line a comment ends on both count.
  const sqls = queries.map(({ sql }) => sql.trim());
  const room = MAX_REF_LENGTH - ref(queries.map(() => "")).length;
  return context({
    ref: ref(fittedSql({ sqls, room })),
    label: `${LANGY_WIDGET_CHIP_LABEL_PREFIX}${widget.name}`,
    // Clicks on different values of one widget are still that widget, listed once; another
    // widget of the same name, here or on another board, is listed beside it.
    key: `${boardKey(board)}:widget:${widget.id ?? widget.name}`,
  });
}

/** What every widget draft fills in: the card's title and the board's period in words. */
function widgetValues({ widget, period }: { widget: WidgetSubject; period: BoardPeriod }) {
  return { question: widget.name, period: boardPeriodInWords(period) };
}

/** A prompt with its `{placeholders}` filled; one with no value is left as it was. */
function filled({ prompt, values }: { prompt: string; values: Readonly<Record<string, string>> }) {
  const byKey = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return prompt.replace(
    /\{([^{}]+)\}/g,
    (match, key: string) => byKey.get(key.toLowerCase()) ?? match,
  );
}

const PLACEHOLDER = /\{[^{}]+\}/;

/**
 * One widget's ask as a composer draft (AC121): what the card answers over the board's period,
 * in the reader's words. The stored prompt, the description and the queries ride in the
 * widget's context (AC247).
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
  const prompt =
    `What does "${widget.name}" show over ${boardPeriodInWords(period)}? Quote the real ` +
    "numbers and tell me what stands out. If there is no data for the period, say so plainly " +
    "rather than guessing.";
  return widgetDraft({ prompt, widget, board, period });
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
    "LangWatch. Base it on the widget's queries.",
  report: (name) =>
    `Send my "${name}" dashboard widget as a scheduled report. Ask me how often and where ` +
    "to send it (Slack, email or webhook), then set the report up in LangWatch. Base it on " +
    "the widget's queries.",
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

/** A button under a widget's chart (AC243), drafting its own prompt about the widget. */
export interface WidgetButtonAction {
  readonly kind: "investigate" | "propose-fix";
  /** The button's words where "Investigate" or "Propose a fix" would read wrong. */
  readonly label?: string;
  /** "problem": only while the widget's code signals its problem (AC244); "always" otherwise. */
  readonly shown: "problem" | "always";
  /** With `{question}` and `{period}` to fill. */
  readonly prompt: string;
}

/** What a click on one of a widget's values drafts (AC245): a prompt per kind of value. */
export interface WidgetClickAction {
  readonly kind: "click";
  /** The kind of value the click names, as the widget's code sends it: "day", "model". */
  readonly on: string;
  /** Set when one kind has a prompt per raw value, as a field per field: the value it is for. */
  readonly value?: string;
  /** The placeholder the series under the pointer fills, as "outcome" in "{outcome} on {day}". */
  readonly series?: string;
  /** With `{question}`, `{period}`, `{<on>}` and `{<series>}` to fill. */
  readonly prompt: string;
}

/** What a catalogue widget declares about asking Langy from its card. */
export type WidgetAction = WidgetButtonAction | WidgetClickAction;

const BUTTON_LABELS: Readonly<Record<WidgetButtonAction["kind"], string>> = {
  investigate: "Investigate",
  "propose-fix": "Propose a fix",
};

/** An action's button label. */
export function widgetActionLabel(action: WidgetButtonAction): string {
  return action.label ?? BUTTON_LABELS[action.kind];
}

/** The buttons a card shows now: the problem ones only while its widget reports the problem. */
export function shownWidgetButtons({
  actions,
  problem,
}: {
  actions: readonly WidgetAction[];
  problem: boolean;
}): readonly WidgetButtonAction[] {
  return actions.filter(
    (action): action is WidgetButtonAction =>
      action.kind !== "click" && (action.shown === "always" || problem),
  );
}

/** The click prompt a widget declares for the kind of value clicked (and its value), if any. */
export function widgetClickFor({
  actions,
  subject,
}: {
  actions: readonly WidgetAction[];
  subject: ChartAskSubject;
}): WidgetClickAction | undefined {
  const kind = subject.kind?.toLowerCase();
  if (kind === void 0) return void 0;
  const value = subject.value ?? subject.label;
  return actions.find(
    (action): action is WidgetClickAction =>
      action.kind === "click" &&
      action.on.toLowerCase() === kind &&
      (action.value === void 0 || action.value === value),
  );
}

/** The clicked value as Langy reads it beside the draft: its kind, raw value, bucket and series. */
function clickedText(subject: ChartAskSubject): string {
  return [
    `${subject.kind ?? "value"} "${subject.label}"`,
    ...(subject.value ? [`raw value ${subject.value}`] : []),
    ...(subject.at ? [`bucket starting ${subject.at}`] : []),
    ...(subject.series ? [`series ${subject.series}`] : []),
  ].join(", ");
}

/**
 * A bar, row, point or legend entry clicked on a widget (AC124, AC245), as a composer draft:
 * the widget's own prompt for that kind of value when it declares one, else a general one.
 * The visible text names the value as the card shows it; its raw value and bucket ride along.
 */
export function widgetChartDraft({
  subject,
  click,
  widget,
  board,
  period,
}: {
  subject: ChartAskSubject;
  click?: WidgetClickAction | undefined;
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const at = subject.at
    ? bucketInWords({ at: subject.at, granularitySeconds: period.granularitySeconds })
    : void 0;
  const values: Record<string, string> = {
    ...widgetValues({ widget, period }),
    day: at ?? subject.label,
  };
  if (click) {
    values[click.on] = click.on.toLowerCase() === "day" ? (at ?? subject.label) : subject.label;
    if (click.series && subject.series) values[click.series] = subject.series;
  }
  const declared = click ? filled({ prompt: click.prompt, values }) : void 0;
  const prompt =
    declared !== void 0 && !PLACEHOLDER.test(declared)
      ? declared
      : generalClickPrompt({ subject, at, values });
  return widgetDraft({ prompt, widget, board, period, focus: clickedText(subject) });
}

function generalClickPrompt({
  subject,
  at,
  values,
}: {
  subject: ChartAskSubject;
  at: string | undefined;
  values: Readonly<Record<string, string>>;
}): string {
  const named = subject.kind && subject.kind !== "series" ? `the ${subject.kind} ` : "";
  // A day's label is the bucket itself; any other value clicked at a bucket is named with it.
  const value =
    subject.kind && !["day", "series"].includes(subject.kind) ? [`${named}"${subject.label}"`] : [];
  const on = [...value, ...(subject.series ? [subject.series] : [])].join(", ");
  const what = at
    ? `${on ? `${on} on ` : ""}${at}`
    : `${named}"${subject.label}" over ${values.period}`;
  return (
    `On "${values.question}", what stands out about ${what}? Find the requests behind it, ` +
    "show me 3 examples and tell me the most likely cause. If there is no data for it, say so " +
    "plainly rather than guessing."
  );
}

/** A widget action button as a composer draft (AC125b, AC243): the widget's own prompt for it. */
export function widgetActionDraft({
  action,
  widget,
  board,
  period,
}: {
  action: WidgetButtonAction;
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const prompt = filled({ prompt: action.prompt, values: widgetValues({ widget, period }) });
  return widgetDraft({ prompt, widget, board, period });
}

/** How many widgets on a board must show no data before the board offers Langy to set them up. */
export const EMPTY_WIDGETS_TO_OFFER_SETUP = 2;

/** Whether a board with these empty widgets offers "Ask Langy to set this up". */
export function offersBoardSetup(emptyWidgetNames: readonly string[]): boolean {
  return emptyWidgetNames.length >= EMPTY_WIDGETS_TO_OFFER_SETUP;
}

/**
 * "Ask Langy to set this up" on a board where several widgets show no data: find out what
 * each one needs and help send it. A draft for the reader to send, about the board.
 */
export function boardSetupDraft({
  emptyWidgetNames,
  board,
  period,
}: {
  emptyWidgetNames: readonly string[];
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const names = emptyWidgetNames.map((name) => `"${name}"`).join(", ");
  const prompt =
    `These widgets on my "${board.name}" dashboard show no data: ${names}. For each one, ` +
    "find out what data it needs and whether my project sends it. Then tell me in plain " +
    "words what fills it: the LangWatch SDK call, the setting or the integration, and help " +
    "me set up what I am missing.";
  return boardPromptDraft({ prompt, board, period });
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
      ? `new widget ${JSON.stringify(widget.name)}, not saved yet`
      : `widget ${JSON.stringify(widget.name)} (id ${widget.id})`;
  return context({
    ref: `${which}, open in the editor on ${boardAskContext({ board, period }).ref}`,
    label: widget.name,
    key: `${boardKey(board)}:editing:${widget.id ?? NEW_WIDGET_REF}`,
  });
}

/** Langy beside the editor, with the widget attached and nothing asked ("Edit code"). */
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

/**
 * Building a widget with Langy, sent at once so Langy starts the conversation: a new widget's
 * starting prompt, or "Edit with Langy" on a saved one. Langy asks what the member wants to
 * see, then proposes the code and queries and saves only on their word.
 */
export function widgetBuildQuestion({
  widget,
  board,
  period,
}: {
  widget: EditedWidget;
  board: BoardSubject;
  period: BoardPeriod;
}): AnalyticsLangyAskRequest {
  const others = board.widgetNames.length > 0 ? board.widgetNames.join(", ") : "nothing yet";
  const prompt =
    widget.id === void 0
      ? `I am building a new widget on my "${board.name}" dashboard, which already shows: ` +
        `${others}. Ask me what I want this widget to show, then propose its code and ` +
        "LangWatchQL queries, and save it only when I agree."
      : `Edit my "${widget.name}" widget on my "${board.name}" dashboard with me. Ask me what ` +
        "I want the widget to show, propose the change to its code and queries, and save it " +
        "only when I agree.";
  // A new widget's starter queries mean nothing to Langy; a saved one's are the subject.
  const attached = widgetEditorContext({ widget, board, period });
  return {
    question: prompt,
    context:
      widget.id === void 0 ? [attached] : [attached, widgetContext({ widget, board, period })],
  };
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
  focus,
  about = boardDraftAbout(board),
  attached = boardAskContext({ board, period }),
}: {
  prompt: string;
  widget: WidgetSubject;
  board: BoardSubject;
  period: BoardPeriod;
  focus?: string;
  about?: AnalyticsLangyDraftAbout;
  /** What rides with the draft beside the widget: the board, or the widget open in the editor. */
  attached?: AnalyticsLangyContext;
}): AnalyticsLangyAskRequest {
  return {
    draft: prompt,
    about,
    context: [attached, widgetContext({ widget, board, period, ...(focus ? { focus } : {}) })],
  };
}

/** The board's reference in a context: first, its quoted name holding no bare quote. */
const escapedRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boardReference = (id: string) =>
  new RegExp(`(dashboard "(?:[^"\\\\]|\\\\.)*" )\\(id ${escapedRegExp(id)}\\)`);

/**
 * An ask built on a new board, retold about the board it was stored as: the board's id in each
 * context and in what the draft is about. Nothing else in the ask names the board by id.
 */
export function askAboutStoredBoard({
  request,
  draftId,
  dashboardId,
}: {
  request: AnalyticsLangyAskRequest;
  draftId: string;
  dashboardId: string;
}): AnalyticsLangyAskRequest {
  const { about } = request;
  const draftKey = boardKey({ id: draftId });
  const storedKey = boardKey({ id: dashboardId });
  // Only the board's own context and the editor's name the board in their reference.
  const namesBoard = (key: string) => key === draftKey || key.startsWith(`${draftKey}:editing:`);
  return {
    ...request,
    context: request.context.map((each) => ({
      ...each,
      ref: namesBoard(each.key)
        ? each.ref.replace(
            boardReference(draftId),
            (_, named: string) => `${named}(id ${dashboardId})`,
          )
        : each.ref,
      key:
        each.key === draftKey || each.key.startsWith(`${draftKey}:`)
          ? `${storedKey}${each.key.slice(draftKey.length)}`
          : each.key,
    })),
    ...(about === void 0
      ? {}
      : { about: about.ref === draftId ? { ...about, ref: dashboardId } : about }),
    ...(request.askedFrom === void 0
      ? {}
      : { askedFrom: request.askedFrom === draftKey ? storedKey : request.askedFrom }),
  };
}

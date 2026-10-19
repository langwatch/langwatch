/**
 * The board check's pure rules: how a widget's statement is prepared, how a failure and a
 * result read, which widgets are broken, and which cards a run files or renews.
 * @see modules/insight/adrs/005-board-health-check.md
 */

import { HandledError, isTransientRefusal } from "@langwatch/handled-error";
import { type InsightEntry, insightExpiresAt, type InsightTone } from "@langwatch/insight-contract";

/** Every card the check files starts its key with this; Langy's keys hold no colon. */
export const BOARD_HEALTH_KEY_PREFIX = "board-health:";

/** The days a card stays in the inbox without a renewal: the days a recovered widget keeps it. */
export const BOARD_HEALTH_VALID_DAYS = 3;

/** The topic chip every card carries. */
export const BOARD_HEALTH_TOPIC = "health";

/** The most cards one run files or renews for one board; the rest share the last card. */
export const MAX_BOARD_HEALTH_CARDS = 5;

/** Widget names one card for the rest lists before it counts the others. */
const MAX_NAMES_IN_REST_CARD = 20;

const MAX_TITLE_NAME_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 1_000;

/** Refusals that read as the person's but that a server-wide limit raises too. */
const PLATFORM_LIMIT_CODES: ReadonlySet<string> = new Set([
  "query_memory_exceeded",
  "query_scan_limit_exceeded",
]);

/** A circuit breaker: this many statements failing with one code, and most of what ran. */
const PLATFORM_WIDE_MIN_FAILURES = 3;

export type BoardHealthReason = "error" | "no_data";

/** Ours, under the refusal's code; a failure that was never a handled error carries none. */
type PlatformFailure = Readonly<{ kind: "platform"; code?: string }>;

/** What one statement of a widget came to. */
export type StatementOutcome =
  | Readonly<{ kind: "data" }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "error"; code: string; message: string }>
  | PlatformFailure
  | Readonly<{ kind: "unchecked" }>;

/** How a failure reads: a refusal to report, ours, or a reason to stop or skip the statement. */
export type StatementFailure =
  | Readonly<{ kind: "off" }>
  | Readonly<{ kind: "window_full"; retryAfterSeconds: number }>
  | Readonly<{ kind: "unchecked" }>
  | PlatformFailure
  | Readonly<{ kind: "error"; code: string; message: string }>;

export type WidgetHealth = "healthy" | BoardHealthReason | "platform" | "unchecked";

/** One stored statement as a widget keeps it, with the parameters it declares. */
export type HealthStatement = Readonly<{
  sql: string;
  parameters?: readonly Readonly<{ name: string; default?: unknown }>[];
}>;

/**
 * The values a statement runs with: each declared parameter's default. A parameter without
 * one is filled by the widget's own code, which no server runs, so the statement is not run.
 */
export function statementParameters(
  statement: HealthStatement,
): Readonly<{ runnable: true; values: Record<string, unknown> }> | Readonly<{ runnable: false }> {
  const declared = statement.parameters ?? [];
  if (declared.some((parameter) => parameter.default === undefined)) return { runnable: false };
  return {
    runnable: true,
    values: Object.fromEntries(declared.map((parameter) => [parameter.name, parameter.default])),
  };
}

function retryAfterOf(error: HandledError): number {
  const value = error.meta?.retryAfterSeconds;
  return typeof value === "number" && value > 0 ? value : 60;
}

/** Reads one failure of a statement's validation or execution. */
export function classifyStatementFailure(error: unknown): StatementFailure {
  if (!HandledError.isHandled(error)) return { kind: "platform" };
  const { code } = error;
  if (code === "lwql_not_enabled") return { kind: "off" };
  if (code === "lwql_rate_limited") {
    return { kind: "window_full", retryAfterSeconds: retryAfterOf(error) };
  }
  if (code === "lwql_parameter_missing") return { kind: "unchecked" };
  if (PLATFORM_LIMIT_CODES.has(code)) return { kind: "platform", code };
  const isPersons = error.fault === "customer" && error.httpStatus < 500;
  if (!isPersons || isTransientRefusal(error)) return { kind: "platform", code };
  return { kind: "error", code, message: error.message };
}

function isNothing(value: unknown): boolean {
  return value === null || value === undefined;
}

/** ClickHouse answers a 64-bit count as a string. */
function isZero(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "bigint") return Number(value) === 0;
  return typeof value === "string" && value.trim() !== "" && Number(value) === 0;
}

/**
 * Empty for no rows, rows of nulls, or a report of no traffic. One row of zeros beside no such
 * report (a rollup view has none, a report can fail) is unchecked: a zero over a busy month
 * must never file "no data".
 */
export function readResult({
  rows,
  completeness,
}: Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  completeness?: Readonly<{ state: string }>;
}>): Extract<StatementOutcome, { kind: "data" | "empty" | "unchecked" }> {
  if (completeness?.state === "no_traffic") return { kind: "empty" };
  const allNothing = rows.every((row) => Object.values(row).every(isNothing));
  if (allNothing) return { kind: "empty" };
  const [only, ...rest] = rows;
  if (only === undefined || rest.length > 0) return { kind: "data" };
  const isZeroRow = Object.values(only).every((value) => isNothing(value) || isZero(value));
  return isZeroRow ? { kind: "unchecked" } : { kind: "data" };
}

/** An error outweighs an empty statement; no data needs every statement run and empty. */
export function widgetHealth(outcomes: readonly StatementOutcome[]): WidgetHealth {
  const has = (kind: StatementOutcome["kind"]) => outcomes.some((outcome) => outcome.kind === kind);
  if (has("error")) return "error";
  if (has("platform")) return "platform";
  if (outcomes.length === 0 || has("unchecked")) return "unchecked";
  return outcomes.every((outcome) => outcome.kind === "empty") ? "no_data" : "healthy";
}

/**
 * Whether one code failed most of what ran: a view we renamed, or an outage, breaks every
 * board at once, so the check then files nothing. Failures with no code count as one code.
 */
export function isPlatformWide(outcomes: readonly StatementOutcome[]): boolean {
  const ran = outcomes.filter((outcome) => outcome.kind !== "unchecked");
  const counts = new Map<string | undefined, number>();
  for (const outcome of ran) {
    if (outcome.kind !== "error" && outcome.kind !== "platform") continue;
    counts.set(outcome.code, (counts.get(outcome.code) ?? 0) + 1);
  }
  const most = Math.max(0, ...counts.values());
  return most >= PLATFORM_WIDE_MIN_FAILURES && most * 2 > ran.length;
}

export function boardHealthKey({
  widgetId,
  reason,
}: {
  widgetId: string;
  reason: BoardHealthReason;
}): string {
  return `${BOARD_HEALTH_KEY_PREFIX}${widgetId}:${reason}`;
}

/** The key of the one card that lists the broken widgets past the cap. */
export function boardHealthRestKey({ boardId }: { boardId: string }): string {
  return `${BOARD_HEALTH_KEY_PREFIX}more:${boardId}`;
}

/** Whether an insight is one of the check's cards. */
export function isBoardHealthKey(findingKey: string | null): boolean {
  return findingKey?.startsWith(BOARD_HEALTH_KEY_PREFIX) === true;
}

/** A broken widget, and for an error what refused it. */
export type BrokenWidget = Readonly<{
  widget: Readonly<{ id: string; name: string }>;
  reason: BoardHealthReason;
  failure?: Readonly<{ code: string; message: string }>;
}>;

/** One card as the check files or renews it. `widget` is null on the card for the rest. */
export type BoardHealthCard = Readonly<{
  key: string;
  title: string;
  body: string;
  tone: InsightTone;
  widget: Readonly<{ id: string; name: string }> | null;
}>;

function cut(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 3).trimEnd()}...` : line;
}

/** A refusal's message may quote a link; a card never carries one. */
function withoutWebAddresses(text: string): string {
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "(link removed)");
}

function widgetCard({ widget, reason, failure }: BrokenWidget): BoardHealthCard {
  const name = cut(widget.name, MAX_TITLE_NAME_LENGTH);
  const key = boardHealthKey({ widgetId: widget.id, reason });
  if (reason === "no_data") {
    return {
      key,
      title: `"${name}" shows no data`,
      body: [
        "None of this widget's queries returned data over the last 30 days.",
        "What it reads may have stopped arriving, or it may read a field nothing sends.",
      ].join(" "),
      tone: "watch",
      widget,
    };
  }
  const code = failure?.code ?? "unknown";
  const message = cut(withoutWebAddresses(failure?.message ?? ""), MAX_MESSAGE_LENGTH);
  return {
    key,
    title: `"${name}" fails to load`,
    body: [
      `This widget's query was refused with \`${code}\` over the last 30 days.`,
      ...(message.length > 0 ? [`It said: ${message}`] : []),
      "Open the widget to see the error and fix its query.",
    ].join("\n\n"),
    tone: "bad",
    widget,
  };
}

function restCard({ boardId, rest }: { boardId: string; rest: readonly BrokenWidget[] }) {
  const named = rest.slice(0, MAX_NAMES_IN_REST_CARD);
  const others = rest.length - named.length;
  const line = ({ widget, reason }: BrokenWidget) =>
    `- "${cut(widget.name, MAX_TITLE_NAME_LENGTH)}": ${reason === "error" ? "fails to load" : "shows no data"}`;
  return {
    key: boardHealthRestKey({ boardId }),
    title: `${rest.length} more widgets on this board need a look`,
    body: [
      "These widgets failed to load or showed no data over the last 30 days:",
      [...named.map(line), ...(others > 0 ? [`- and ${others} more`] : [])].join("\n"),
    ].join("\n\n"),
    tone: rest.some(({ reason }) => reason === "error") ? "bad" : "watch",
    widget: null,
  } satisfies BoardHealthCard;
}

/**
 * The cards for a board's broken widgets, in board order: one each up to the cap, or one
 * each for the first below it and one card that names the rest.
 */
export function boardHealthCards({
  boardId,
  broken,
}: {
  boardId: string;
  broken: readonly BrokenWidget[];
}): BoardHealthCard[] {
  if (broken.length <= MAX_BOARD_HEALTH_CARDS) return broken.map(widgetCard);
  const own = broken.slice(0, MAX_BOARD_HEALTH_CARDS - 1);
  return [...own.map(widgetCard), restCard({ boardId, rest: broken.slice(own.length) })];
}

/** What a run does with one card: files it under its own id, or renews the one it repeats. */
export type BoardHealthAct =
  | Readonly<{ kind: "file"; card: BoardHealthCard; insightId: string }>
  | Readonly<{ kind: "renew"; card: BoardHealthCard; insight: InsightEntry }>;

/** Ran out: no renewal for its days and not kept. A card marked done is not resolved by that. */
function isResolved({ entry, slot }: { entry: InsightEntry; slot: number }): boolean {
  return entry.keptAt === null && slot >= insightExpiresAt(entry);
}

/**
 * Decides each card by the newest insight with its key on this board, whenever it was filed:
 * none, or one resolved, files the card; this run's own id files it again, as a retry does;
 * any other is renewed, so one marked done stays done while the widget stays broken.
 */
export function decideBoardHealthActs({
  cards,
  existing,
  boardId,
  slot,
  insightIdOf,
}: {
  cards: readonly BoardHealthCard[];
  /** The person's insights holding the cards' keys. */
  existing: readonly InsightEntry[];
  boardId: string;
  slot: number;
  insightIdOf: (key: string) => string;
}): BoardHealthAct[] {
  return cards.map((card): BoardHealthAct => {
    const insightId = insightIdOf(card.key);
    const newest = existing
      .filter((entry) => entry.findingKey === card.key && entry.board?.id === boardId)
      .toSorted((a, b) => b.filedAt - a.filedAt || a.id.localeCompare(b.id))[0];
    if (!newest || newest.id === insightId || isResolved({ entry: newest, slot })) {
      return { kind: "file", card, insightId };
    }
    return { kind: "renew", card, insight: newest };
  });
}

/**
 * The cards the developer has to answer while a turn runs (ADR-129) — a
 * permission ask for one command on their machine, or a question Langy needs
 * settled before it goes on.
 *
 * TWO SOURCES, ONE ANSWER. The durable record is the truth: the wait rides on
 * the tool call it belongs to (`LangyTurnWait`), so a tab that adopted a
 * running turn renders the card from the folded turn document alone, with no
 * live stream at all. The live stream entries are the fast path for the tab
 * that sent the message, and the wake-up that says the card is there now.
 *
 * The merge rule is the same for both kinds: a terminal state wins over
 * `pending`, whichever side reports it first. Nothing here can invent a
 * terminal state, so the worst a lost entry costs is latency.
 *
 * Pure and JSX-free: the cards render what this yields, and the panel routes
 * the answer with the wait id it carries.
 */
import type { LangyTurnToolCall, LangyTurnWait } from "@langwatch/langy";

/** The wait states a card can be in, durable and live alike. */
export type LangyWaitStatus = "pending" | "answered" | "expired" | "cancelled";

/**
 * What the panel says while a card waits and a folder is shared from a
 * terminal.
 *
 * The same ask is open in that terminal, which is where the developer is
 * looking, so a line that sent them to the browser cost them the flow they
 * came for. One sentence, used by the waiting line and by the composer, so
 * the two can never disagree.
 */
export const LANGY_ANSWER_HERE_OR_TERMINAL =
  "Answer on the card above or in the terminal.";

/** The decisions a permission card records. */
export type LangyPermissionDecision = "allow_once" | "allow_pattern" | "deny";

/**
 * Where a permission answer was given. An ask can be answered on the card or
 * in the terminal that shares the folder, and the settled card names the
 * terminal so the reader knows the answer was not lost.
 */
export type LangyPermissionAnswerSource = "panel" | "terminal";

/**
 * One live stream entry about a wait, in the shape the transport hands over.
 * Deliberately structural rather than the stream union: this module is the
 * only reader, and typing it here keeps the panel's live path and the card's
 * props one contract.
 */
export interface LangyLiveWait {
  waitId: string;
  kind: "permission" | "question";
  status: LangyWaitStatus;
  toolCallId?: string;
  callId?: string;
  summary?: string;
  pattern?: string;
  patterns?: string[];
  reason?: string;
  timeoutSeconds?: number;
  skipOffered?: boolean;
  workspaceName?: string;
  hostname?: string;
  decision?: string;
  source?: string;
  questions?: unknown;
  answers?: unknown;
}

/** Everything one permission card reads. */
export interface LangyPermissionCardData {
  waitId: string;
  status: LangyWaitStatus;
  decision: LangyPermissionDecision | null;
  /** Where the answer was given. Null reads as the card in the panel. */
  source: LangyPermissionAnswerSource | null;
  /** The exact command, as it will run. */
  command: string;
  /** The pattern a session grant would cover, when one is offered. */
  pattern: string | null;
  /**
   * Every pattern one session grant covers. A chain that fetches and then
   * checks out grants both, and the button has to name both: one click gave
   * away more than the first pattern, and the session's grants are readable
   * nowhere else.
   */
  patterns: string[];
  reason: string | null;
  /** The seconds after which the command is stopped, or null with no limit. */
  timeoutSeconds: number | null;
  skipOffered: boolean;
  workspaceName: string | null;
  hostname: string | null;
}

/** What the panel needs to route one question card's answer. */
export interface LangyQuestionWait {
  waitId: string;
  status: LangyWaitStatus;
}

const DECISIONS = new Set<string>(["allow_once", "allow_pattern", "deny"]);

function readDecision(value: unknown): LangyPermissionDecision | null {
  return typeof value === "string" && DECISIONS.has(value)
    ? (value as LangyPermissionDecision)
    : null;
}

const ANSWER_SOURCES = new Set<string>(["panel", "terminal"]);

function readSource(value: unknown): LangyPermissionAnswerSource | null {
  return typeof value === "string" && ANSWER_SOURCES.has(value)
    ? (value as LangyPermissionAnswerSource)
    : null;
}

/**
 * The state to render, given what each side reports. A card is pending only
 * while BOTH sides still say so: the durable record settles a card for every
 * tab, and the live entry settles it for this one before the tail arrives.
 */
export function mergeLangyWaitStatus({
  durable,
  live,
}: {
  durable?: LangyWaitStatus | undefined;
  live?: LangyWaitStatus | undefined;
}): LangyWaitStatus {
  if (durable && durable !== "pending") return durable;
  if (live && live !== "pending") return live;
  return durable ?? live ?? "pending";
}

interface WaitSources {
  /**
   * Every card of the whole conversation, off the durable record
   * (`langy.localRecord`). The broadest source and the slowest: it is what
   * puts a card raised before this tab was watching on screen, and what keeps
   * the answered cards of a finished conversation on screen when it is
   * reopened. The two sources below overwrite it as they arrive.
   */
  record?: readonly LangyRecordWait[] | null | undefined;
  /** The folded turn document's tool calls, or null before any turn is seen. */
  toolCalls?: readonly LangyTurnToolCall[] | null | undefined;
  /** Live entries by wait id, newest state per id. */
  live?: Readonly<Record<string, LangyLiveWait>> | undefined;
}

/** One card as the durable conversation record carries it. */
export type LangyRecordWait = LangyTurnWait & { toolCallId: string };

function durableWaits(sources: WaitSources): LangyTurnWait[] {
  return [
    ...(sources.record ?? []),
    ...(sources.toolCalls ?? []).flatMap((call) =>
      call.wait ? [call.wait] : [],
    ),
  ];
}

/**
 * One permission card folded over its other durable reading.
 *
 * The two durable sources are the same record read at two moments, so neither
 * is simply newer: the turn fold can hold the answer the record has not caught
 * up with, and the record can hold the answer for a turn this browser stopped
 * folding. A card only ever moves forward.
 */
function mergeDurable({
  known,
  next,
}: {
  known: LangyPermissionCardData;
  next: LangyPermissionCardData;
}): LangyPermissionCardData {
  return {
    ...known,
    ...next,
    status: mergeLangyWaitStatus({ durable: known.status, live: next.status }),
    decision: next.decision ?? known.decision,
    source: next.source ?? known.source,
    command: next.command || known.command,
    pattern: next.pattern ?? known.pattern,
    patterns: next.patterns.length > 0 ? next.patterns : known.patterns,
    reason: next.reason ?? known.reason,
    timeoutSeconds: next.timeoutSeconds ?? known.timeoutSeconds,
  };
}

/**
 * Every permission card of the current turn, in the order the commands were
 * asked about. A live entry with no durable twin still renders — that is the
 * whole point of the fast path — and the durable twin then takes over without
 * the card moving, because both key by wait id.
 */
export function langyPermissionCards(
  sources: WaitSources,
): LangyPermissionCardData[] {
  const cards = new Map<string, LangyPermissionCardData>();

  for (const wait of durableWaits(sources)) {
    if (wait.kind !== "permission") continue;
    const known = cards.get(wait.waitId);
    const next = fromDurable(wait);
    cards.set(wait.waitId, known ? mergeDurable({ known, next }) : next);
  }
  for (const entry of Object.values(sources.live ?? {})) {
    if (entry.kind !== "permission") continue;
    cards.set(entry.waitId, withLive(cards.get(entry.waitId), entry));
  }

  // A card with no command names nothing the reader can rule on, so it is not
  // a card — that is a malformed ask, and it stays off the screen.
  return [...cards.values()].filter((card) => card.command !== "");
}

/**
 * The patterns to name, given what a source carries.
 *
 * A record written before the ask carried its whole list holds one pattern,
 * and that one pattern is then the whole answer: the card names what it knows
 * rather than nothing at all.
 */
function patternsOf({
  patterns,
  pattern,
}: {
  patterns?: readonly string[] | null | undefined;
  pattern?: string | null | undefined;
}): string[] {
  if (patterns && patterns.length > 0) return [...patterns];
  return pattern ? [pattern] : [];
}

/** One permission card as the durable record holds it. */
function fromDurable(wait: LangyTurnWait): LangyPermissionCardData {
  return {
    waitId: wait.waitId,
    status: wait.status,
    decision: readDecision(wait.decision),
    source: readSource(wait.source),
    command: wait.summary ?? "",
    pattern: wait.pattern,
    patterns: patternsOf({ patterns: wait.patterns, pattern: wait.pattern }),
    reason: wait.reason,
    timeoutSeconds: wait.timeoutSeconds ?? null,
    skipOffered: wait.skipOffered,
    workspaceName: wait.workspaceName,
    hostname: wait.hostname,
  };
}

/** The patterns to name for a card both sides describe: the durable list first. */
function mergePatterns({
  durable,
  entry,
}: {
  durable: LangyPermissionCardData | undefined;
  entry: LangyLiveWait;
}): string[] {
  const known = patternsOf({
    patterns: durable?.patterns,
    pattern: durable?.pattern,
  });
  if (known.length > 0) return known;
  return patternsOf({ patterns: entry.patterns, pattern: entry.pattern });
}

/**
 * The same card once the live stream has spoken. The durable side wins every
 * detail it holds — it was written by the server, not by a frame that may be
 * partial — and the live side contributes the state and whatever the durable
 * side has not carried yet.
 */
function withLive(
  durable: LangyPermissionCardData | undefined,
  entry: LangyLiveWait,
): LangyPermissionCardData {
  return {
    waitId: entry.waitId,
    status: mergeLangyWaitStatus({
      durable: durable?.status,
      live: entry.status,
    }),
    decision: durable?.decision ?? readDecision(entry.decision),
    source: durable?.source ?? readSource(entry.source),
    command: durable?.command || (entry.summary ?? ""),
    pattern: durable?.pattern ?? entry.pattern ?? null,
    patterns: mergePatterns({ durable, entry }),
    reason: durable?.reason ?? entry.reason ?? null,
    timeoutSeconds: durable?.timeoutSeconds ?? entry.timeoutSeconds ?? null,
    skipOffered: durable?.skipOffered ?? entry.skipOffered ?? false,
    workspaceName: durable?.workspaceName ?? entry.workspaceName ?? null,
    hostname: durable?.hostname ?? entry.hostname ?? null,
  };
}

/** One question wait as a map entry, keyed by the tool call that asked. */
type QuestionWaitEntry = [toolCallId: string, wait: LangyQuestionWait];

/** Every question wait the durable record carries. */
function recordQuestionWaits(sources: WaitSources): QuestionWaitEntry[] {
  return (sources.record ?? []).flatMap((wait) =>
    wait.kind === "question"
      ? ([
          [wait.toolCallId, { waitId: wait.waitId, status: wait.status }],
        ] satisfies QuestionWaitEntry[])
      : [],
  );
}

/** The same, read off the folded turn document's tool calls. */
function foldedQuestionWaits(sources: WaitSources): QuestionWaitEntry[] {
  return (sources.toolCalls ?? []).flatMap((call) =>
    call.wait?.kind === "question"
      ? ([
          [
            call.toolCallId,
            { waitId: call.wait.waitId, status: call.wait.status },
          ],
        ] satisfies QuestionWaitEntry[])
      : [],
  );
}

/** The same, read off the live entries this tab is watching. */
function liveQuestionWaits(sources: WaitSources): QuestionWaitEntry[] {
  return Object.values(sources.live ?? {}).flatMap((entry) =>
    entry.kind === "question" && entry.toolCallId
      ? ([
          [entry.toolCallId, { waitId: entry.waitId, status: entry.status }],
        ] satisfies QuestionWaitEntry[])
      : [],
  );
}

/**
 * The question waits of the current turn, keyed by the tool call that asked.
 * The choices card knows its own tool call id (its block id derives from it),
 * so this is what turns a selection into an answer the waiting tool receives
 * instead of the next user message.
 */
export function langyQuestionWaitsByToolCall(
  sources: WaitSources,
): Map<string, LangyQuestionWait> {
  const waits = new Map<string, LangyQuestionWait>(
    recordQuestionWaits(sources),
  );

  // Each later source only moves a wait forward, so a status one of them has
  // not caught up with is never rolled back over the one that has.
  for (const [toolCallId, wait] of [
    ...foldedQuestionWaits(sources),
    ...liveQuestionWaits(sources),
  ]) {
    waits.set(toolCallId, {
      waitId: wait.waitId,
      status: mergeLangyWaitStatus({
        durable: waits.get(toolCallId)?.status,
        live: wait.status,
      }),
    });
  }

  return waits;
}

/**
 * Where one choices answer goes.
 *
 * A question the tool asked MID-TURN is a tool waiting on a person: the answer
 * returns to the wait and Langy carries on with the plan it had. Every other
 * answer — a question whose wait already ended, a card from a settled turn, a
 * stamped choices block — is the next USER MESSAGE, which is the path the
 * choices card has always taken.
 */
export function routeLangyChoiceAnswer({
  blockId,
  waits,
}: {
  blockId: string;
  waits: ReadonlyMap<string, LangyQuestionWait>;
}): { kind: "wait"; waitId: string } | { kind: "message" } {
  const toolCallId = toolCallIdOfQuestionBlock(blockId);
  const wait = toolCallId ? waits.get(toolCallId) : undefined;
  return wait && wait.status === "pending"
    ? { kind: "wait", waitId: wait.waitId }
    : { kind: "message" };
}

/**
 * The tool call a choices card's block id names. The question bridge mints
 * `question:<toolCallId>:<index>`, and the tool call id is the only part of it
 * the wait knows, so the split is here rather than at every call site.
 */
export function toolCallIdOfQuestionBlock(blockId: string): string | null {
  if (!blockId.startsWith("question:")) return null;
  const rest = blockId.slice("question:".length);
  const lastColon = rest.lastIndexOf(":");
  const toolCallId = lastColon === -1 ? rest : rest.slice(0, lastColon);
  return toolCallId === "" ? null : toolCallId;
}

/**
 * The cards the developer has to answer while a turn runs (ADR-129). Two sources, one answer:
 * the durable record is the truth, the live stream is the fast path — a terminal state always
 * wins over `pending`, whichever side reports it first. Pure and JSX-free.
 */
import type { LangyTurnToolCall, LangyTurnWait } from "@langwatch/langy-contract";

/** The wait states a card can be in, durable and live alike. */
export type LangyWaitStatus = "pending" | "answered" | "expired" | "cancelled";

/**
 * What the panel says while a card waits and a folder is shared from a terminal, since the
 * same ask is open there. Shared by the waiting line and the composer, so they can't disagree.
 */
export const LANGY_ANSWER_HERE_OR_TERMINAL = "Answer on the card above or in the terminal.";

/** The decisions a permission card records. */
export type LangyPermissionDecision = "allow_once" | "allow_pattern" | "deny";

/**
 * Where a permission answer was given. An ask can be answered on the card or
 * in the terminal that shares the folder, and the settled card names the
 * terminal so the reader knows the answer was not lost.
 */
export type LangyPermissionAnswerSource = "panel" | "terminal";

/**
 * One live stream entry about a wait, structural rather than the stream union — this module is
 * the only reader, keeping the panel's live path and the card's props one contract.
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
  /** Every pattern one session grant covers — grants are readable nowhere else. */
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

/**
 * One question card, as the wait that raised it carries it — not the transcript, whose
 * `question` tool part can reach the screen minutes after the tool started waiting.
 */
export interface LangyQuestionCardData {
  waitId: string;
  /** The tool call that asked, which is what an answer is routed back on. */
  toolCallId: string | null;
  status: LangyWaitStatus;
  /** The `questions` payload the tool sent, in its own shape. */
  questions: unknown;
  /** The answers the wait settled with, when it settled with any. */
  answers: unknown;
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
  /** Every card of the whole conversation, off the durable record — the broadest, slowest
   * source, overwritten by the two below as they arrive. */
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
    ...(sources.toolCalls ?? []).flatMap((call) => (call.wait ? [call.wait] : [])),
  ];
}

/**
 * One permission card folded over its other durable reading — neither source is simply newer,
 * so a card only ever moves forward.
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
 * Every permission card of the current turn. A live entry with no durable twin still renders
 * (the point of the fast path); the durable twin then takes over without the card moving.
 */
export function langyPermissionCards(sources: WaitSources): LangyPermissionCardData[] {
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
 * The patterns to name, given what a source carries — a record with just one pattern makes that
 * the whole answer, rather than nothing at all.
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

/** The durable side wins any detail it holds; a nullable field falls back to null. */
function mergeNullable<T>(durable: T | null | undefined, live: T | null | undefined): T | null {
  return durable ?? live ?? null;
}

/** Same rule, for the one boolean-valued field (defaults false rather than null). */
function mergeSkipOffered(durable: boolean | undefined, live: boolean | undefined): boolean {
  return durable ?? live ?? false;
}

function mergeCommand(durable: string | undefined, entry: LangyLiveWait): string {
  return durable || (entry.summary ?? "");
}

/**
 * The same card once the live stream has spoken — the durable side wins every detail it holds,
 * and the live side contributes the state plus whatever the durable side hasn't carried yet.
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
    command: mergeCommand(durable?.command, entry),
    pattern: mergeNullable(durable?.pattern, entry.pattern),
    patterns: mergePatterns({ durable, entry }),
    reason: mergeNullable(durable?.reason, entry.reason),
    timeoutSeconds: mergeNullable(durable?.timeoutSeconds, entry.timeoutSeconds),
    skipOffered: mergeSkipOffered(durable?.skipOffered, entry.skipOffered),
    workspaceName: mergeNullable(durable?.workspaceName, entry.workspaceName),
    hostname: mergeNullable(durable?.hostname, entry.hostname),
  };
}

/**
 * Every question card of the conversation, off the same three sources the
 * permission cards come from and folded by the same forward-only rule.
 */
export function langyQuestionCards(sources: WaitSources): LangyQuestionCardData[] {
  const cards = new Map<string, LangyQuestionCardData>();
  // Each later source only moves a card forward, the same rule the permission
  // cards and the question waits above fold by.
  for (const next of [
    ...recordQuestionCards(sources),
    ...foldedQuestionCards(sources),
    ...liveQuestionCards(sources),
  ]) {
    const known = cards.get(next.waitId);
    cards.set(next.waitId, known ? mergeQuestionCard({ known, next }) : next);
  }
  return [...cards.values()];
}

/** Every question card the durable conversation record carries. */
function recordQuestionCards(sources: WaitSources): LangyQuestionCardData[] {
  return (sources.record ?? []).flatMap((wait) =>
    wait.kind === "question"
      ? [
          {
            waitId: wait.waitId,
            toolCallId: wait.toolCallId,
            status: wait.status,
            questions: wait.questions,
            answers: wait.answers,
          },
        ]
      : [],
  );
}

/** The same, read off the folded turn document's tool calls. */
function foldedQuestionCards(sources: WaitSources): LangyQuestionCardData[] {
  return (sources.toolCalls ?? []).flatMap((call) =>
    call.wait?.kind === "question"
      ? [
          {
            waitId: call.wait.waitId,
            toolCallId: call.toolCallId,
            status: call.wait.status,
            questions: call.wait.questions,
            answers: call.wait.answers,
          },
        ]
      : [],
  );
}

/** The same, read off the live entries this tab is watching. */
function liveQuestionCards(sources: WaitSources): LangyQuestionCardData[] {
  return Object.values(sources.live ?? {}).flatMap((entry) =>
    entry.kind === "question"
      ? [
          {
            waitId: entry.waitId,
            toolCallId: entry.toolCallId ?? null,
            status: entry.status,
            questions: entry.questions ?? null,
            answers: entry.answers ?? null,
          },
        ]
      : [],
  );
}

/** The same card folded over another reading of it. A card only moves forward. */
function mergeQuestionCard({
  known,
  next,
}: {
  known: LangyQuestionCardData;
  next: LangyQuestionCardData;
}): LangyQuestionCardData {
  return {
    waitId: known.waitId,
    toolCallId: next.toolCallId ?? known.toolCallId,
    status: mergeLangyWaitStatus({ durable: known.status, live: next.status }),
    questions: known.questions ?? next.questions,
    answers: next.answers ?? known.answers,
  };
}

/**
 * The option ids one settled question wait names, given the card's own options — a wait
 * records the answer as labels (what the tool reads), while the card binds by id.
 */
export function langyAnsweredOptionIds({
  answers,
  options,
}: {
  answers: unknown;
  options: readonly { id: string; label: string }[];
}): { optionIds: string[]; otherText?: string } | null {
  if (!Array.isArray(answers) || answers.length === 0) return null;
  const first = answers[0] as {
    selected?: unknown;
    other?: unknown;
  } | null;
  if (!first || typeof first !== "object") return null;
  const selected = Array.isArray(first.selected)
    ? first.selected.filter((label): label is string => typeof label === "string")
    : [];
  const idByLabel = new Map(options.map((option) => [option.label, option.id] as const));
  const optionIds = selected.flatMap((label) => {
    const id = idByLabel.get(label);
    return id ? [id] : [];
  });
  const otherText =
    typeof first.other === "string" && first.other.trim() !== "" ? first.other : undefined;
  if (optionIds.length === 0 && otherText === undefined) return null;
  return { optionIds, ...(otherText === undefined ? {} : { otherText }) };
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
          [call.toolCallId, { waitId: call.wait.waitId, status: call.wait.status }],
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
 * The question waits of the current turn, keyed by the tool call that asked, so a selection
 * can be routed to the waiting tool instead of the next user message.
 */
export function langyQuestionWaitsByToolCall(sources: WaitSources): Map<string, LangyQuestionWait> {
  const waits = new Map<string, LangyQuestionWait>(recordQuestionWaits(sources));

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
 * Where one choices answer goes: a mid-turn question routes back to the waiting tool; every
 * other case (settled turn, already-ended wait, stamped block) goes as the next user message.
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

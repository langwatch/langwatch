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

/** The decisions a permission card records. */
export type LangyPermissionDecision = "allow_once" | "allow_pattern" | "deny";

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
  reason?: string;
  skipOffered?: boolean;
  workspaceName?: string;
  hostname?: string;
  decision?: string;
  questions?: unknown;
  answers?: unknown;
}

/** Everything one permission card reads. */
export interface LangyPermissionCardData {
  waitId: string;
  status: LangyWaitStatus;
  decision: LangyPermissionDecision | null;
  /** The exact command, as it will run. */
  command: string;
  /** The pattern a session grant would cover, when one is offered. */
  pattern: string | null;
  reason: string | null;
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
  /** The folded turn document's tool calls, or null before any turn is seen. */
  toolCalls?: readonly LangyTurnToolCall[] | null | undefined;
  /** Live entries by wait id, newest state per id. */
  live?: Readonly<Record<string, LangyLiveWait>> | undefined;
}

function durableWaits(sources: WaitSources): LangyTurnWait[] {
  return (sources.toolCalls ?? []).flatMap((call) =>
    call.wait ? [call.wait] : [],
  );
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
    if (wait.kind === "permission") cards.set(wait.waitId, fromDurable(wait));
  }
  for (const entry of Object.values(sources.live ?? {})) {
    if (entry.kind !== "permission") continue;
    cards.set(entry.waitId, withLive(cards.get(entry.waitId), entry));
  }

  // A card with no command names nothing the reader can rule on, so it is not
  // a card — that is a malformed ask, and it stays off the screen.
  return [...cards.values()].filter((card) => card.command !== "");
}

/** One permission card as the durable record holds it. */
function fromDurable(wait: LangyTurnWait): LangyPermissionCardData {
  return {
    waitId: wait.waitId,
    status: wait.status,
    decision: readDecision(wait.decision),
    command: wait.summary ?? "",
    pattern: wait.pattern,
    reason: wait.reason,
    skipOffered: wait.skipOffered,
    workspaceName: wait.workspaceName,
    hostname: wait.hostname,
  };
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
    command: durable?.command || (entry.summary ?? ""),
    pattern: durable?.pattern ?? entry.pattern ?? null,
    reason: durable?.reason ?? entry.reason ?? null,
    skipOffered: durable?.skipOffered ?? entry.skipOffered ?? false,
    workspaceName: durable?.workspaceName ?? entry.workspaceName ?? null,
    hostname: durable?.hostname ?? entry.hostname ?? null,
  };
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
  const waits = new Map<string, LangyQuestionWait>();

  for (const call of sources.toolCalls ?? []) {
    const wait = call.wait;
    if (wait?.kind !== "question") continue;
    waits.set(call.toolCallId, { waitId: wait.waitId, status: wait.status });
  }

  for (const entry of Object.values(sources.live ?? {})) {
    if (entry.kind !== "question" || !entry.toolCallId) continue;
    const durable = waits.get(entry.toolCallId);
    waits.set(entry.toolCallId, {
      waitId: entry.waitId,
      status: mergeLangyWaitStatus({
        durable: durable?.status,
        live: entry.status,
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

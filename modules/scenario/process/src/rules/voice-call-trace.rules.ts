import { createHash } from "node:crypto";

import type { CallTurn } from "@langwatch/scenario-contract";

/** How the run records who spoke as the caller: a person, not a simulator. */
export const HUMAN_CALLER_KIND = "human";

/**
 * One exchange: a caller utterance and the agent utterances answering it.
 * `callerText` is absent for a leading agent greeting; `agentText` is absent
 * when the caller spoke and the agent has not answered yet.
 */
export interface VoiceExchange {
  index: number;
  /** Indices into `record.turns` that belong to this exchange, in order. */
  turnIndices: number[];
  callerText?: string;
  agentText?: string;
  startMs?: number;
  endMs?: number;
}

function isCallerTurn(turn: CallTurn): boolean {
  return turn.role === "caller";
}

function openExchange(exchanges: VoiceExchange[]): VoiceExchange {
  const exchange: VoiceExchange = {
    index: exchanges.length,
    turnIndices: [],
  };
  exchanges.push(exchange);
  return exchange;
}

/** Fold a turn's text into its exchange: a caller utterance is the input, agent
 *  utterances are joined into the output. */
function applyTurnContent(exchange: VoiceExchange, turn: CallTurn): void {
  if (isCallerTurn(turn)) {
    // At most one caller turn reaches an exchange: groupTurnsIntoExchanges opens
    // a new exchange on every caller turn, so this never overwrites.
    exchange.callerText = turn.text;
    return;
  }
  exchange.agentText =
    exchange.agentText === undefined ? turn.text : `${exchange.agentText}\n${turn.text}`;
}

function applyTurnTiming(exchange: VoiceExchange, turn: CallTurn): void {
  if (turn.startMs !== undefined) {
    exchange.startMs = Math.min(exchange.startMs ?? turn.startMs, turn.startMs);
  }
  if (turn.endMs !== undefined) {
    exchange.endMs = Math.max(exchange.endMs ?? turn.endMs, turn.endMs);
  }
}

/**
 * Group a call's turns into exchanges. A caller turn opens a new exchange; agent
 * turns append to the open one, or open exchange 0 when they lead the call (a
 * greeting before the caller speaks).
 */
export function groupTurnsIntoExchanges(turns: CallTurn[]): VoiceExchange[] {
  const exchanges: VoiceExchange[] = [];
  let open: VoiceExchange | undefined;
  turns.forEach((turn, index) => {
    const current = isCallerTurn(turn) || open === undefined ? openExchange(exchanges) : open;
    open = current;
    current.turnIndices.push(index);
    applyTurnContent(current, turn);
    applyTurnTiming(current, turn);
  });
  return exchanges;
}

/**
 * The deterministic trace and root-span ids for an exchange, derived from the
 * conversation id and the exchange index alone (mirrors
 * `scenarioRunIdForConversation`). A trace id is 32 hex chars, a span id 16.
 */
export function voiceCallTraceIds({
  conversationId,
  exchangeIndex,
}: {
  conversationId: string;
  exchangeIndex: number;
}): { traceId: string; spanId: string } {
  const sha = (input: string) => createHash("sha256").update(input).digest("hex");
  return {
    traceId: sha(`${conversationId}:${exchangeIndex}`).slice(0, 32),
    spanId: sha(`${conversationId}:${exchangeIndex}:root`).slice(0, 16),
  };
}

/**
 * Writes one trace per exchange of a finished voice call, so every message the
 * run renders can deep-link the trace of the exchange it belongs to (the drawer
 * probes `msg.trace_id`). This is the browser-call counterpart of the traces a
 * simulated run emits: same ingestion path (`getApp().traces.recordSpan` → the
 * standard OTLP fold), same thread grouping (`gen_ai.conversation.id`), same
 * `gen_ai.input/output.messages` shape the previews read.
 *
 * An exchange is one caller utterance plus the agent utterances that answer it;
 * a leading agent greeting is exchange 0 with no caller input. Every turn in an
 * exchange carries that exchange's trace id.
 *
 * The ids are derived from the conversation id and the exchange index alone, so
 * a re-driven finish (a retried hang-up completing a half-written run — #7973)
 * recomputes the identical ids and the fold dedupes rather than duplicating.
 *
 * Best effort: a `recordSpan` failure is logged and swallowed. The ids are
 * still returned so the messages link to them; the fold picks the span up if a
 * later attempt succeeds.
 *
 * Server-only: derives the ids with `node:crypto`.
 */

import { createHash } from "node:crypto";

import { createLogger } from "@langwatch/observability";

import { getApp } from "~/server/app-layer/app";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import type { CallRecord, CallTurn } from "./call-record";
import { HUMAN_CALLER_KIND } from "./voice-run-writer";

const logger = createLogger("langwatch:voice:call-trace-writer");

/** The scenario a "Call it myself" call is scored under. Absent for a drawer
 *  call, which flips the span origin to `application`. */
export interface VoiceTraceScenario {
  scenarioId: string;
  scenarioSetId: string;
}

/**
 * One exchange: a single caller utterance and the agent utterances that answer
 * it. `callerText` is absent for a leading agent greeting; `agentText` is absent
 * when the caller spoke and the agent has not answered yet (two caller turns in
 * a row).
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

/** Open a fresh exchange at the next index and register it. */
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
    exchange.agentText === undefined
      ? turn.text
      : `${exchange.agentText}\n${turn.text}`;
}

/** Widen the exchange window to cover a turn's reported offsets, when it has
 *  any. */
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
    const current =
      isCallerTurn(turn) || open === undefined ? openExchange(exchanges) : open;
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
  const sha = (input: string) =>
    createHash("sha256").update(input).digest("hex");
  return {
    traceId: sha(`${conversationId}:${exchangeIndex}`).slice(0, 32),
    spanId: sha(`${conversationId}:${exchangeIndex}:root`).slice(0, 16),
  };
}

type OtlpAttribute = {
  key: string;
  value: { stringValue?: string; intValue?: number };
};

/** The span attributes for one exchange (decision 4). */
function exchangeAttributes({
  exchange,
  record,
  scenario,
  scenarioRunId,
}: {
  exchange: VoiceExchange;
  record: CallRecord;
  scenario?: VoiceTraceScenario;
  scenarioRunId: string;
}): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [
    {
      key: "gen_ai.conversation.id",
      value: { stringValue: record.conversationId },
    },
    { key: "langwatch.span.type", value: { stringValue: "agent" } },
    {
      key: "langwatch.origin",
      value: { stringValue: scenario ? "simulation" : "application" },
    },
    { key: "voice.turn.index", value: { intValue: exchange.index } },
    { key: "voice.call.id", value: { stringValue: record.conversationId } },
    { key: "voice.call.transport", value: { stringValue: record.transport } },
    { key: "voice.call.source", value: { stringValue: record.source } },
    {
      key: "voice.call.caller",
      value: { stringValue: HUMAN_CALLER_KIND },
    },
  ];
  if (exchange.callerText !== undefined) {
    attrs.push({
      key: "gen_ai.input.messages",
      value: {
        stringValue: JSON.stringify([
          { role: "user", content: exchange.callerText },
        ]),
      },
    });
  }
  if (exchange.agentText !== undefined) {
    attrs.push({
      key: "gen_ai.output.messages",
      value: {
        stringValue: JSON.stringify([
          { role: "assistant", content: exchange.agentText },
        ]),
      },
    });
  }
  if (scenario) {
    attrs.push(
      { key: "scenario.id", value: { stringValue: scenario.scenarioId } },
      {
        key: "scenario.set_id",
        value: { stringValue: scenario.scenarioSetId },
      },
      { key: "scenario.run_id", value: { stringValue: scenarioRunId } },
    );
  }
  return attrs;
}

/** Whether every turn reports both a start and end offset, so the measured
 *  windows can be trusted for the whole call. */
function everyTurnHasOffsets(turns: CallTurn[]): boolean {
  return turns.every(
    (turn) => turn.startMs !== undefined && turn.endMs !== undefined,
  );
}

/** The exchange's [start, end] in epoch ms. When every turn in the call reports
 *  both offsets (`useMeasuredOffsets`), each exchange uses its own measured
 *  window; otherwise the whole call falls back to an even split across the
 *  exchanges. The choice is call-wide so windows are always monotonic and
 *  non-overlapping — never mixing a real timestamp with a neighbour's split. */
function exchangeWindowMs({
  exchange,
  exchangeCount,
  record,
  useMeasuredOffsets,
}: {
  exchange: VoiceExchange;
  exchangeCount: number;
  record: CallRecord;
  useMeasuredOffsets: boolean;
}): { startMs: number; endMs: number } {
  if (
    useMeasuredOffsets &&
    exchange.startMs !== undefined &&
    exchange.endMs !== undefined
  ) {
    return {
      startMs: record.startedAt + exchange.startMs,
      endMs: record.startedAt + exchange.endMs,
    };
  }
  const slice =
    (record.endedAt - record.startedAt) / Math.max(exchangeCount, 1);
  const startMs = record.startedAt + slice * exchange.index;
  return { startMs, endMs: startMs + slice };
}

/**
 * Emit one root span per exchange and return the per-turn trace ids (one entry
 * per `record.turns[i]`, in order). Failures are logged and swallowed; the ids
 * are returned regardless (decision 7).
 */
export async function recordVoiceCallTraces({
  projectId,
  record,
  scenario,
  scenarioRunId,
}: {
  projectId: string;
  record: CallRecord;
  scenario?: VoiceTraceScenario;
  scenarioRunId: string;
}): Promise<{ turnTraceIds: string[] }> {
  const exchanges = groupTurnsIntoExchanges(record.turns);
  const useMeasuredOffsets = everyTurnHasOffsets(record.turns);
  const turnTraceIds: string[] = new Array(record.turns.length);

  for (const exchange of exchanges) {
    const { traceId, spanId } = voiceCallTraceIds({
      conversationId: record.conversationId,
      exchangeIndex: exchange.index,
    });
    for (const turnIndex of exchange.turnIndices)
      turnTraceIds[turnIndex] = traceId;

    const { startMs, endMs } = exchangeWindowMs({
      exchange,
      exchangeCount: exchanges.length,
      record,
      useMeasuredOffsets,
    });
    try {
      await getApp().traces.recordSpan({
        tenantId: projectId,
        span: {
          traceId,
          spanId,
          traceState: null,
          parentSpanId: null,
          name: "Voice Call Turn",
          kind: 1,
          startTimeUnixNano: String(Math.round(startMs) * 1_000_000),
          endTimeUnixNano: String(Math.round(endMs) * 1_000_000),
          attributes: exchangeAttributes({
            exchange,
            record,
            scenario,
            scenarioRunId,
          }),
          events: [],
          links: [],
          status: { code: 1 },
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        },
        resource: {
          attributes: [
            {
              key: "langwatch.origin.source",
              value: { stringValue: "platform" },
            },
            { key: "service.name", value: { stringValue: "langwatch-voice" } },
          ],
        },
        instrumentationScope: { name: "langwatch.voice", version: null },
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
        occurredAt: record.endedAt,
      });
    } catch (err) {
      logger.error(
        {
          err,
          projectId,
          scenarioRunId,
          traceId,
          exchangeIndex: exchange.index,
        },
        "Failed to record voice call trace",
      );
    }
  }

  return { turnTraceIds };
}

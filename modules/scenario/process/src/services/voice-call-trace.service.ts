/**
 * Writes one trace per voice-call exchange: one caller utterance + agent replies.
 * IDs derived from conversation id and exchange index (dedupes re-driven finishes #7973).
 * Best effort; recordSpan failures logged but swallowed.
 */

import { createLogger } from "@langwatch/observability";
import type { CallRecord, CallTurn } from "@langwatch/scenario-contract";
import { DEFAULT_PII_REDACTION_LEVEL, type RecordSpanCommandData } from "@langwatch/trace-contract";

import {
  groupTurnsIntoExchanges,
  HUMAN_CALLER_KIND,
  voiceCallTraceIds,
  type VoiceExchange,
} from "../rules/voice-call-trace.rules.ts";
import type { VoiceSessionInfrastructure } from "./voice-call.service.ts";

/**
 * What recording a call's traces reaches outside itself: the trace ingress
 * command every span goes through, injected rather than located globally,
 * so a unit test records against an in-memory collector.
 */
interface VoiceCallTraceRecorderCollaborators {
  traces: { recordSpan(input: RecordSpanCommandData): Promise<void> };
}

const logger = createLogger("langwatch:voice:call-trace-writer");

/** The scenario a "Call it myself" call is scored under. Absent for a drawer
 *  call, which flips the span origin to `application`. */
interface VoiceTraceScenario {
  scenarioId: string;
  scenarioSetId: string;
}

type OtlpAttribute = {
  key: string;
  value: { stringValue?: string; intValue?: number };
};

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
        stringValue: JSON.stringify([{ role: "user", content: exchange.callerText }]),
      },
    });
  }
  if (exchange.agentText !== undefined) {
    attrs.push({
      key: "gen_ai.output.messages",
      value: {
        stringValue: JSON.stringify([{ role: "assistant", content: exchange.agentText }]),
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
  return turns.every((turn) => turn.startMs !== undefined && turn.endMs !== undefined);
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
  if (useMeasuredOffsets && exchange.startMs !== undefined && exchange.endMs !== undefined) {
    return {
      startMs: record.startedAt + exchange.startMs,
      endMs: record.startedAt + exchange.endMs,
    };
  }
  const slice = (record.endedAt - record.startedAt) / Math.max(exchangeCount, 1);
  const startMs = record.startedAt + slice * exchange.index;
  return { startMs, endMs: startMs + slice };
}

type RecordSpanInput = RecordSpanCommandData;

/** The raw-OTLP `recordSpan` payload for one exchange's root span. */
function buildExchangeSpanInput({
  projectId,
  record,
  scenario,
  scenarioRunId,
  exchange,
  traceId,
  spanId,
  startMs,
  endMs,
}: {
  projectId: string;
  record: CallRecord;
  scenario?: VoiceTraceScenario;
  scenarioRunId: string;
  exchange: VoiceExchange;
  traceId: string;
  spanId: string;
  startMs: number;
  endMs: number;
}): RecordSpanInput {
  return {
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
  };
}

/** Record one exchange's root span; a failure is logged and swallowed
 *  (decision 7) so the caller can always attach the derived ids. */
async function recordExchangeSpan({
  traces,
  projectId,
  scenarioRunId,
  exchange,
  traceId,
  input,
}: {
  traces: VoiceCallTraceRecorderCollaborators["traces"];
  projectId: string;
  scenarioRunId: string;
  exchange: VoiceExchange;
  traceId: string;
  input: RecordSpanInput;
}): Promise<void> {
  try {
    await traces.recordSpan(input);
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

/**
 * Emit one root span per exchange and return the per-turn trace ids (one entry
 * per `record.turns[i]`, in order). Failures are logged and swallowed; the ids
 * are returned regardless (decision 7).
 */
function createVoiceCallTraceRecorder(
  collaborators: VoiceCallTraceRecorderCollaborators,
): VoiceSessionInfrastructure["recordCallTraces"] {
  return async function recordVoiceCallTraces({
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
    const turnTraceIds: string[] = Array.from({ length: record.turns.length });

    for (const exchange of exchanges) {
      const { traceId, spanId } = voiceCallTraceIds({
        conversationId: record.conversationId,
        exchangeIndex: exchange.index,
      });
      for (const turnIndex of exchange.turnIndices) turnTraceIds[turnIndex] = traceId;

      const { startMs, endMs } = exchangeWindowMs({
        exchange,
        exchangeCount: exchanges.length,
        record,
        useMeasuredOffsets,
      });
      const input = buildExchangeSpanInput({
        projectId,
        record,
        scenario,
        scenarioRunId,
        exchange,
        traceId,
        spanId,
        startMs,
        endMs,
      });
      await recordExchangeSpan({
        traces: collaborators.traces,
        projectId,
        scenarioRunId,
        exchange,
        traceId,
        input,
      });
    }

    return { turnTraceIds };
  };
}

/** Records one trace per exchange of a finished call, bound to the trace ingress it writes to. */
export class VoiceCallTraceService {
  static create(collaborators: VoiceCallTraceRecorderCollaborators): VoiceCallTraceService {
    return new VoiceCallTraceService(collaborators);
  }

  readonly recordCallTraces: VoiceSessionInfrastructure["recordCallTraces"];

  private constructor(collaborators: VoiceCallTraceRecorderCollaborators) {
    this.recordCallTraces = createVoiceCallTraceRecorder(collaborators);
  }
}

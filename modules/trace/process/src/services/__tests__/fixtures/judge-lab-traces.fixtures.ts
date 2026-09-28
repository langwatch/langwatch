/**
 * Agent traces in the shapes the judge-lab benchmark sends (synthetic content): OTel GenAI
 * chat and execute_tool spans, and a LangWatch SDK RAG call whose retrieved passages ride in a
 * later system message. `witnesses` are the values a judge needs to see in the rendering.
 */
import type { OtlpSpan } from "@langwatch/trace-contract";

export interface JudgeLabTrace {
  scope: { name: string; version: string };
  spans: OtlpSpan[];
  witnesses: string[];
}

type Attr = string | number | Record<string, unknown> | unknown[];

const TRACE_ID = "5f0c3a9e2b7d41c8a6e9f10b2c3d4e5f";
const T0_MS = Date.UTC(2026, 9, 13, 9, 0, 0);

function otlpValue(value: Attr): { stringValue: string } | { intValue: number } {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { intValue: value };
  return { stringValue: JSON.stringify(value) };
}

function otlpSpan({
  id,
  parent,
  name,
  startMs,
  endMs,
  attributes,
}: {
  id: string;
  parent?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, Attr>;
}): OtlpSpan {
  return {
    traceId: TRACE_ID,
    spanId: id,
    parentSpanId: parent ?? null,
    name,
    kind: 1,
    startTimeUnixNano: String(BigInt(T0_MS + startMs) * 1_000_000n),
    endTimeUnixNano: String(BigInt(T0_MS + endMs) * 1_000_000n),
    attributes: Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) })),
    events: [],
    links: [],
    status: { code: 1, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

const RATES_ARGS = { unitCode: "DV-6", arrival: "2026-10-13", departure: "2026-10-20" };
const RATES_RESULT = {
  unit: "Dune Villa 6p",
  periods: [
    { from: "2026-10-13", to: "2026-10-16", nightly: 139.5 },
    { from: "2026-10-16", to: "2026-10-20", nightly: 104.5 },
  ],
  cleaningFee: 65,
  touristTaxPerAdultNight: 1.95,
};
const REPLY = "3 nights at 139.50 plus 4 nights at 104.50, cleaning 65.00 and tourist tax 27.30: total 928.80.";

/** An OTel GenAI agent: the tool result reaches the last chat span as a tool_call_response part. */
export function genAiToolAgentTrace(): JudgeLabTrace {
  const system = "You are the holiday park copilot. Always use the tools; never guess prices.";
  const user = "Total for the Dune Villa 6p, 13 to 20 October, two adults?";
  const toolCall = { type: "tool_call", id: "call_rates1", name: "get_rates", arguments: RATES_ARGS };
  const history = [
    { role: "system", parts: [{ type: "text", content: system }] },
    { role: "user", parts: [{ type: "text", content: user }] },
  ];
  return {
    scope: { name: "opentelemetry.instrumentation.openai_agents", version: "0.3.0" },
    witnesses: ["139.5", "104.5", "1.95"],
    spans: [
      otlpSpan({
        id: "a000000000000001",
        name: "agent.run",
        startMs: 0,
        endMs: 4_000,
        attributes: { "langwatch.span.type": "agent", "langwatch.input": user, "langwatch.output": REPLY },
      }),
      otlpSpan({
        id: "a000000000000002",
        parent: "a000000000000001",
        name: "chat gpt-5-mini",
        startMs: 10,
        endMs: 900,
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.input.messages": history,
          "gen_ai.output.messages": [{ role: "assistant", parts: [toolCall], finish_reason: "tool_calls" }],
        },
      }),
      otlpSpan({
        id: "a000000000000003",
        parent: "a000000000000001",
        name: "execute_tool get_rates",
        startMs: 910,
        endMs: 1_300,
        attributes: {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "get_rates",
          "gen_ai.tool.call.id": "call_rates1",
          "gen_ai.tool.call.arguments": RATES_ARGS,
          "gen_ai.tool.call.result": RATES_RESULT,
        },
      }),
      otlpSpan({
        id: "a000000000000004",
        parent: "a000000000000001",
        name: "chat gpt-5-mini",
        startMs: 1_310,
        endMs: 3_900,
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.input.messages": [
            ...history,
            { role: "assistant", parts: [toolCall] },
            {
              role: "tool",
              parts: [{ type: "tool_call_response", id: "call_rates1", response: RATES_RESULT }],
            },
          ],
          "gen_ai.output.messages": [
            { role: "assistant", parts: [{ type: "text", content: REPLY }], finish_reason: "stop" },
          ],
        },
      }),
    ],
  };
}

const PASSAGE =
  "3.2 Questions. Questions must be received no later than 10 working days before the deadline for submission of tenders.";

/** A LangWatch SDK RAG call: the retrieved passages sit in a system message after the user turn. */
export function langWatchRagTrace(): JudgeLabTrace {
  const system = "You are a bid-management companion. Answer from the retrieved passages only.";
  const user = "What is the last day to send clarification questions?";
  return {
    scope: { name: "langwatch", version: "0.9.0" },
    witnesses: ["10 working days"],
    spans: [
      otlpSpan({
        id: "b000000000000001",
        name: "agent.run",
        startMs: 0,
        endMs: 2_700,
        attributes: {
          "langwatch.span.type": "agent",
          "langwatch.input": user,
          "langwatch.output": "Tuesday 24 November 2026.",
        },
      }),
      otlpSpan({
        id: "b000000000000002",
        parent: "b000000000000001",
        name: "llm",
        startMs: 450,
        endMs: 2_650,
        attributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "openai/gpt-5-mini",
          "langwatch.input": {
            type: "chat_messages",
            value: [
              { role: "system", content: system },
              { role: "user", content: user },
              { role: "system", content: `Retrieved context:\n\n[Tender-Guidelines.pdf#14] ${PASSAGE}` },
            ],
          },
          "langwatch.output": {
            type: "chat_messages",
            value: [{ role: "assistant", content: "Tuesday 24 November 2026." }],
          },
        },
      }),
    ],
  };
}

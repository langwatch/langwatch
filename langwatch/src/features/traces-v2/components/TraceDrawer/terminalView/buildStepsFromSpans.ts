import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  type ChatMessage,
  coerceToChatMessages,
  groupMessagesIntoTurns,
} from "../transcript";
import { groupSpansByAgent } from "./agents";
import type { TerminalStep } from "./terminalSession";

/**
 * The real span Claude Code emits per model call. Its `input` is the Anthropic
 * Messages request (the rolling history) and its `output` the assistant reply —
 * both joined on at read time from the trace's OTLP log records, since the span
 * itself carries only tokens + `request_id`.
 */
const LLM_REQUEST_SPAN = "claude_code.llm_request";

/**
 * Rebuild a coding-agent turn's terminal session from its spans.
 *
 * One LangWatch trace is one Claude Code turn, and a turn is an agentic LOOP:
 * the model is called, asks for a tool, the tool runs, the model is called
 * again with the result, and so on until it answers. Each of those model calls
 * is its own `claude_code.llm_request` span.
 *
 * The key property we lean on: every call carries the ROLLING message history,
 * so the LAST call's input already contains the whole turn — the user's prompt,
 * every `tool_use` the model asked for, and every `tool_result` that came back.
 * Appending that call's own reply completes the transcript. That's why this
 * reads the final span rather than stitching the calls together: the stitching
 * has already been done by the agent, and re-deriving it would risk dropping or
 * double-counting steps.
 *
 * Metrics are summed across ALL the calls, though — the turn's real cost is the
 * whole loop, not just its last hop.
 */
export function buildTerminalStepsFromSpans(
  spans: SpanDetail[],
): TerminalStep[] {
  // Only the MAIN thread's model calls. A turn can spawn sub-agents, each
  // running its own conversation with its own rolling history — so "the last
  // model call carries the whole turn" holds per AGENT, not per trace. Reading
  // the trace's last llm_request would happily hand back a sub-agent's
  // transcript and pass it off as the turn.
  const { main } = groupSpansByAgent(spans);
  const modelCalls = main.spans
    .filter((span) => span.name === LLM_REQUEST_SPAN)
    .slice()
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  const finalCall = modelCalls[modelCalls.length - 1];
  if (!finalCall) return [];

  const messages: ChatMessage[] = [
    ...(coerceToChatMessages(finalCall.input) ?? []),
  ];
  if (typeof finalCall.output === "string" && finalCall.output.trim()) {
    messages.push({ role: "assistant", content: finalCall.output });
  }
  if (messages.length === 0) return [];

  // The turn costs what the whole loop cost, not what its last hop cost.
  const totals = modelCalls.reduce(
    (acc, span) => ({
      tokens:
        acc.tokens +
        (span.metrics?.promptTokens ?? 0) +
        (span.metrics?.completionTokens ?? 0),
      costUsd: acc.costUsd + (span.metrics?.cost ?? 0),
    }),
    { tokens: 0, costUsd: 0 },
  );

  const turns = groupMessagesIntoTurns(messages);
  return turns.map((turn, index) => {
    const isFinalBeat = index === turns.length - 1;
    return {
      turn,
      timestamp: finalCall.startTimeMs,
      model: finalCall.model ?? undefined,
      // Attribute the turn's totals to its closing beat only, so the timeline
      // HUD's running total counts the turn exactly once as you scrub.
      tokens: isFinalBeat && totals.tokens > 0 ? totals.tokens : undefined,
      costUsd: isFinalBeat && totals.costUsd > 0 ? totals.costUsd : undefined,
    };
  });
}

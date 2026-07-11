import type { TraceListItem } from "../../../types/trace";
import {
  type ChatMessage,
  coerceToChatMessages,
  type ContentBlock,
  groupMessagesIntoTurns,
  parseContentBlocks,
} from "../transcript";
import type { TerminalStep } from "../terminalView";

/** True when a message carries actual prose (not just tool_result echoes). */
function hasProse(blocks: ContentBlock[]): boolean {
  return blocks.some((b) => b.kind === "text");
}

/**
 * The user prompt that opened a turn: the last text-bearing user message in the
 * request history. Anthropic echoes tool results back as `role=user` messages
 * with no prose — those are not prompts, so we skip them.
 */
function lastUserPrompt(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "user") continue;
    if (hasProse(parseContentBlocks(msg.content))) return msg;
  }
  return null;
}

/**
 * The assistant's response for a turn. Mirrors the I/O viewer's output slicing:
 * when the output payload carries the whole history, keep only what follows the
 * last real user message (this turn's operation chain); when it is already just
 * the response, keep it whole.
 */
function responseMessages(messages: ChatMessage[]): ChatMessage[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "user") continue;
    if (hasProse(parseContentBlocks(msg.content))) {
      lastUserIndex = i;
      break;
    }
  }
  return lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;
}

/**
 * Reconstruct a coding-agent session as an ordered list of `TerminalStep`s from
 * the conversation's traces, for the drawer's Terminal view.
 *
 * Each trace is one turn: its user prompt (the last text-bearing user message in
 * the request payload) followed by its assistant response (the output payload).
 * Turn content is shaped through the exact transcript path the conversation view
 * uses — `coerceToChatMessages` then `groupMessagesIntoTurns` — so both views
 * agree on turn structure rather than reinventing it. The opening trace also
 * contributes the system prompt once.
 *
 * Per-trace timeline metrics (`timestamp`, `model`) ride on every beat of the
 * trace; the trace's `tokens`/`cost` are attributed to its final (assistant)
 * beat only, so the timeline HUD's running totals count each trace exactly once.
 */
export function buildTerminalSteps(traces: TraceListItem[]): TerminalStep[] {
  const steps: TerminalStep[] = [];

  traces.forEach((trace, traceIndex) => {
    const inputMessages = coerceToChatMessages(trace.input) ?? [];
    const outputMessages = coerceToChatMessages(trace.output) ?? [];

    const messages: ChatMessage[] = [];
    // Surface the system prompt once, from the opening trace.
    if (traceIndex === 0) {
      messages.push(...inputMessages.filter((m) => m.role === "system"));
    }
    const prompt = lastUserPrompt(inputMessages);
    if (prompt) messages.push(prompt);
    if (outputMessages.length > 0) {
      messages.push(...responseMessages(outputMessages));
    } else if (typeof trace.output === "string" && trace.output.trim()) {
      // Output wasn't chat-shaped — keep the raw response as an assistant beat
      // rather than dropping it.
      messages.push({ role: "assistant", content: trace.output });
    }

    if (messages.length === 0) return;

    const turns = groupMessagesIntoTurns(messages);
    turns.forEach((turn, turnIndex) => {
      const isFinalBeat = turnIndex === turns.length - 1;
      steps.push({
        turn,
        timestamp: trace.timestamp,
        model: trace.models[0],
        tokens: isFinalBeat ? trace.totalTokens : undefined,
        costUsd: isFinalBeat ? trace.totalCost : undefined,
      });
    });
  });

  return steps;
}

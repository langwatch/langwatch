import { parseContentBlocks } from "./parsing";
import type { ChatMessage } from "./types";

/** Which side of a captured LLM call a chat payload is being read as. */
export type ChatPanel = "input" | "output";

/**
 * Split a chat-shaped payload the way the trace drawer's two panels read it.
 *
 *   - `input` = the conversation history sent to the model on this turn:
 *     user messages, system / developer prompts, and every prior assistant
 *     operation (thinking, tool_use, tool_result echoes, intermediate text).
 *     Tool_use ids in the input are distinct from those in the output (they
 *     belong to earlier LLM calls in the agent loop), so this is real history,
 *     not duplicated output. Trailing assistant messages are trimmed because
 *     those are this turn's response and belong to the output side.
 *   - `output` = everything after the last text-bearing user message, in full.
 *     That request is the last thing the reader asked for, so it belongs to the
 *     history; what follows it is the answer. Keeping all of it leaves the
 *     agent's reasoning, tool calls, tool results and intermediate assistant
 *     turns visible as the response, which is what they are. Narrowing it to
 *     the final assistant message hides the operation chain.
 *
 * A payload with no text-bearing user message (the common case for an
 * output payload that carries only the reply) is returned whole.
 */
export function splitChatForPanel({
  messages,
  panel,
}: {
  messages: ChatMessage[];
  panel: ChatPanel;
}): ChatMessage[] {
  if (panel === "output") {
    const requestedAt = lastTextBearingUserIndex(messages);
    return requestedAt >= 0 ? messages.slice(requestedAt + 1) : messages;
  }
  return messages.slice(0, historyEndIndex(messages));
}

/**
 * Where the last thing the user actually said in words sits, or -1 when the
 * payload has none. A user-role message carrying only tool results is the
 * agent loop echoing itself, not a request.
 */
function lastTextBearingUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const blocks = parseContentBlocks(message.content);
    if (blocks.some((block) => block.kind === "text")) return i;
  }
  return -1;
}

/** Where the history ends: before the trailing run of assistant messages. */
function historyEndIndex(messages: ChatMessage[]): number {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.role === "assistant") {
    end--;
  }
  return end;
}

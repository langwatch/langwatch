import { parseContentBlocks } from "./parsing.ts";
import type { ChatMessage } from "./types.ts";

/** Which side of a captured LLM call a chat payload is being read as. */
export type ChatPanel = "input" | "output";

/**
 * Split a chat-shaped payload the way the trace drawer's two panels read it:
 * `input` is the history without this turn's trailing assistant run, `output`
 * is everything after the last text-bearing user message.
 * @see specs/traces/trace-extraction-modules.feature — Splitting a chat payload
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

/**
 * The trailing run of assistant messages is this turn's own reply, so the
 * history the model was given stops right before it.
 */
function historyEndIndex(messages: ChatMessage[]): number {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.role === "assistant") {
    end--;
  }
  return end;
}

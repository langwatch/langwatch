import { type ChatMessage, parseContentBlocks } from "@langwatch/trace-contract/transcript";

/** Index of the last user message that carries text, or -1. */
function lastUserTextIndex(messages: ChatMessage[]): number {
  return messages.findLastIndex(
    (message) =>
      message.role === "user" &&
      parseContentBlocks(message.content).some((block) => block.kind === "text"),
  );
}

/**
 * The messages an input or output panel shows. Output shows what followed the
 * last user message with text. Input shows the whole history the model was
 * sent, minus the assistant messages trailing it, which are the output.
 */
export function panelChatMessages({
  messages,
  mode,
}: {
  messages: ChatMessage[];
  mode: "input" | "output";
}): ChatMessage[] {
  if (mode === "output") return messages.slice(lastUserTextIndex(messages) + 1);
  const lastNonAssistant = messages.findLastIndex((message) => message.role !== "assistant");
  return messages.slice(0, lastNonAssistant + 1);
}

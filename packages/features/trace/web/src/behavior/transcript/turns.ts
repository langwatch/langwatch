import { getReasoning, parseContentBlocks } from "./parsing.ts";
import type { ChatMessage, ContentBlock, ConversationTurn } from "../../model/transcript/types.ts";

/**
 * Whether a user-role message carries no user prose — every block is an assistant
 * operation echoed back through the user role — and should fold into the assistant
 * chain instead of starting its own turn.
 */
function isAssistantOperationEcho(blocks: ContentBlock[]): boolean {
  return (
    blocks.length > 0 &&
    blocks.every((b) => b.kind === "tool_result" || b.kind === "tool_use" || b.kind === "thinking")
  );
}

/** Folds `msg` into the trailing assistant turn, or starts a new one. */
function appendToAssistantTurn(
  turns: ConversationTurn[],
  msg: ChatMessage,
  blocks: ContentBlock[],
): void {
  // If the message has reasoning_content (OpenAI) or thinking (top-level)
  // that isn't already in the content blocks, prepend it now so it
  // renders as a proper ReasoningBlock in the stack.
  const reasoning = getReasoning(msg, blocks);
  if (reasoning && !blocks.some((b) => b.kind === "thinking")) {
    blocks.unshift({ kind: "thinking", text: reasoning });
  }

  const last = turns[turns.length - 1];
  if (last && last.kind === "assistant") {
    last.blocks.push(...blocks);
    if (msg.tool_calls) last.toolCalls.push(...msg.tool_calls);
    last.messages.push(msg);
  } else {
    turns.push({
      kind: "assistant",
      blocks,
      toolCalls: msg.tool_calls ? [...msg.tool_calls] : [],
      messages: [msg],
    });
  }
}

/** Appends one raw chat message to `turns`, folding or starting a turn as needed. */
function appendMessageToTurns(turns: ConversationTurn[], msg: ChatMessage): void {
  const blocks = parseContentBlocks(msg.content);

  if (msg.role === "system" || msg.role === "developer") {
    turns.push({ kind: "system", role: msg.role, blocks, messages: [msg] });
    return;
  }

  if (msg.role === "user") {
    if (isAssistantOperationEcho(blocks)) {
      appendToAssistantTurn(turns, msg, blocks);
      return;
    }
    // Real user message. Each user message is its own turn — even if the
    // previous turn was also user (two messages in a row remain two distinct
    // beats). Within this single turn, all its blocks (thinking / text /
    // tool_use / …) render together.
    turns.push({
      kind: "user",
      blocks,
      toolCalls: msg.tool_calls ? [...msg.tool_calls] : [],
      messages: [msg],
    });
    return;
  }

  // assistant / tool / function — fold into the assistant operation chain.
  appendToAssistantTurn(turns, msg, blocks);
}

/**
 * Group raw chat messages into logical turns. Each message stays as its own turn (two
 * consecutive user messages are two distinct beats — we don't merge them just because
 * they share a role). The one exception:
 */
export function groupMessagesIntoTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const msg of messages) {
    appendMessageToTurns(turns, msg);
  }
  return turns;
}

export function summarizeTurn(turn: ConversationTurn): string {
  if (turn.kind === "user") {
    const text = turn.blocks
      .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join(" ");
    if (text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 140);
    const tu = turn.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "tool_use" }> => b.kind === "tool_use",
    );
    if (tu) return `Tool · ${tu.name}`;
    return "—";
  }
  if (turn.kind === "system") {
    const text = turn.blocks
      .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join(" ");
    return text.replace(/\s+/g, " ").trim().slice(0, 140) || "—";
  }
  const text = turn.blocks
    .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join(" ");
  if (text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 140);
  const thinking = turn.blocks.find(
    (b): b is Extract<ContentBlock, { kind: "thinking" }> => b.kind === "thinking",
  );
  if (thinking) {
    return `Thinking — ${thinking.text.replace(/\s+/g, " ").trim().slice(0, 100)}`;
  }
  const tu = turn.blocks.find(
    (b): b is Extract<ContentBlock, { kind: "tool_use" }> => b.kind === "tool_use",
  );
  if (tu) return `Tool · ${tu.name}`;
  if (turn.toolCalls.length > 0) {
    return `Tool · ${turn.toolCalls[0]!.function.name}`;
  }
  return "—";
}

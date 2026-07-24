import { getReasoning, parseContentBlocks } from "./parsing";
import type { ChatMessage, ContentBlock, ConversationTurn } from "./types";

/**
 * Group raw chat messages into logical turns. Each message stays as its
 * own turn (two consecutive user messages are two distinct beats — we
 * don't merge them just because they share a role). The one exception:
 *
 *   • Anthropic emits `tool_result` blocks as `role=user` messages — the
 *     API echoing the tool result back to continue the assistant. Those
 *     fold into the preceding assistant turn so the chain reads as one
 *     operation, not as user/assistant/user/assistant ping-pong.
 *
 * Within a single message, *all* its content blocks (thinking + text +
 * tool_use + …) render together inside that message's turn — that's the
 * shape the model emitted, and it should be obvious in the UI.
 */
export function groupMessagesIntoTurns(
  messages: ChatMessage[],
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Fold a user-role message into the preceding assistant turn whenever
  // the message carries no actual user prose. That covers:
  //   - the standard Anthropic tool_result echo pattern (every block is
  //     a tool_result);
  //   - mislabeled traces where tool_use / thinking blocks ended up under
  //     role=user — semantically they're always assistant operations.
  // A "user" message with at least one text block is treated as a real
  // user beat regardless of any other blocks alongside it.
  const isAssistantOperationEcho = (blocks: ContentBlock[]) =>
    blocks.length > 0 && !blocks.some((b) => b.kind === "text");

  const appendToAssistant = (msg: ChatMessage, blocks: ContentBlock[]) => {
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
  };

  for (const msg of messages) {
    const blocks = parseContentBlocks(msg.content);

    if (msg.role === "system" || msg.role === "developer") {
      turns.push({
        kind: "system",
        role: msg.role,
        blocks,
        messages: [msg],
      });
      continue;
    }

    if (msg.role === "user") {
      if (isAssistantOperationEcho(blocks)) {
        // No user prose in this message — it's an assistant op echoed
        // back through the user role. Fold into the assistant chain.
        appendToAssistant(msg, blocks);
      } else {
        // Real user message. Each user message is its own turn — even if
        // the previous turn was also user (two messages in a row remain
        // two distinct beats). Within this single turn, all its blocks
        // (thinking / text / tool_use / …) render together.
        turns.push({
          kind: "user",
          blocks,
          toolCalls: msg.tool_calls ? [...msg.tool_calls] : [],
          messages: [msg],
        });
      }
      continue;
    }

    // assistant / tool / function — fold into the assistant operation chain.
    appendToAssistant(msg, blocks);
  }

  return turns;
}

export function summarizeTurn(turn: ConversationTurn): string {
  if (turn.kind === "user") {
    const text = turn.blocks
      .filter(
        (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
      )
      .map((b) => b.text)
      .join(" ");
    if (text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 140);
    const tu = turn.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "tool_use" }> =>
        b.kind === "tool_use",
    );
    if (tu) return `Tool · ${tu.name}`;
    return "—";
  }
  if (turn.kind === "system") {
    const text = turn.blocks
      .filter(
        (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
      )
      .map((b) => b.text)
      .join(" ");
    return text.replace(/\s+/g, " ").trim().slice(0, 140) || "—";
  }
  const text = turn.blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
    )
    .map((b) => b.text)
    .join(" ");
  if (text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 140);
  const thinking = turn.blocks.find(
    (b): b is Extract<ContentBlock, { kind: "thinking" }> =>
      b.kind === "thinking",
  );
  if (thinking) {
    return `Thinking — ${thinking.text.replace(/\s+/g, " ").trim().slice(0, 100)}`;
  }
  const tu = turn.blocks.find(
    (b): b is Extract<ContentBlock, { kind: "tool_use" }> =>
      b.kind === "tool_use",
  );
  if (tu) return `Tool · ${tu.name}`;
  if (turn.toolCalls.length > 0) {
    return `Tool · ${turn.toolCalls[0]!.function.name}`;
  }
  return "—";
}

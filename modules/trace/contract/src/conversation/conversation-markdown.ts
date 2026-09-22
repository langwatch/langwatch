import { formatDuration, formatRelativeTime, isoTimestamp } from "../trace-time-format.ts";
import { extractSystemText } from "../transcript/transcript-text-extraction.ts";
import type { ConversationTurnSource, ParsedTurn } from "./parsed-turns.ts";

export interface ConversationMarkdownChunk {
  /** Stable key for the virtualizer. */
  id: string;
  /** Markdown source for this chunk. */
  markdown: string;
  /**
   * 1-based turn this chunk belongs to, absent on the conversation preamble
   * (heading and system prompt). It is what lets a budgeted render drop whole
   * turns while keeping the preamble and the turn numbering intact.
   */
  turnNumber?: number;
}

/**
 * The conversation markdown as independently-renderable chunks: one renderer
 * per chunk through a virtualizer, and finer than per-turn so one huge
 * assistant answer cannot pin a giant row in memory.
 */
export function buildConversationMarkdownChunks({
  conversationId,
  turns,
}: {
  conversationId: string;
  turns: ParsedTurn<ConversationTurnSource>[];
}): ConversationMarkdownChunk[] {
  const chunks: ConversationMarkdownChunk[] = [
    { id: "header", markdown: conversationHeader({ conversationId, turns }) },
  ];

  // A long system prompt can dwarf the conversation itself, so it gets its own
  // chunk and stays unmounted until scrolled to.
  const systemPrompt = extractSystemText(turns[0]?.turn.input);
  if (systemPrompt) {
    chunks.push({
      id: "system",
      markdown: ["## System", "", "```", systemPrompt, "```"].join("\n"),
    });
  }

  for (let i = 0; i < turns.length; i++) {
    chunks.push(...turnChunks({ parsed: turns[i]!, turnNumber: i + 1 }));
  }

  return chunks;
}

function conversationHeader({
  conversationId,
  turns,
}: {
  conversationId: string;
  turns: ParsedTurn<ConversationTurnSource>[];
}): string {
  // A threadless trace has no conversation id to name, so the heading stands
  // on its own rather than trailing an empty pair of backticks.
  const lines: string[] = [
    conversationId ? `# Conversation \`${conversationId}\`` : "# Conversation",
    "",
    `- **Turns:** ${turns.length}`,
  ];
  const first = turns[0]?.turn;
  const last = turns[turns.length - 1]?.turn;
  if (!first || !last) return lines.join("\n");

  lines.push(`- **Started:** ${isoTimestamp(first.timestamp)}`);
  lines.push(`- **Last turn:** ${isoTimestamp(last.timestamp)}`);
  let totalCost = 0;
  let totalTokens = 0;
  for (const parsed of turns) {
    totalCost += parsed.turn.totalCost ?? 0;
    totalTokens += parsed.turn.totalTokens;
  }
  if (totalCost > 0) lines.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
  if (totalTokens > 0) lines.push(`- **Total tokens:** ${totalTokens}`);
  return lines.join("\n");
}

function turnChunks({
  parsed,
  turnNumber,
}: {
  parsed: ParsedTurn<ConversationTurnSource>;
  turnNumber: number;
}): ConversationMarkdownChunk[] {
  const { turn } = parsed;
  const model = turn.models[0] ? turn.models[0] : "—";
  const chunks: ConversationMarkdownChunk[] = [
    {
      id: `turn-${turnNumber}-header`,
      turnNumber,
      markdown: `## Turn ${turnNumber} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    },
  ];

  const user = renderUserSide(parsed);
  if (user) {
    chunks.push({ id: `turn-${turnNumber}-user`, turnNumber, markdown: user });
  }
  const reply = renderReplySide(parsed);
  if (reply) {
    chunks.push({
      id: `turn-${turnNumber}-${reply.kind}`,
      turnNumber,
      markdown: reply.markdown,
    });
  }
  return chunks;
}

/**
 * The user side of a turn, or nothing when it recorded none. `[Redacted]`
 * where the server nulled the text: dropping it silently would make a pasted
 * transcript read as if the turn never happened.
 */
function renderUserSide({ userText, turn }: ParsedTurn<ConversationTurnSource>): string | null {
  if (userText) return ["**User:**", "", userText].join("\n");
  if (turn.inputRedacted) return ["**User:**", "", "_[Redacted]_"].join("\n");
  return null;
}

/**
 * The reply side of a turn, or nothing when it recorded none. The extracted
 * prose wins, raw output is the fallback for a tool-only turn, and a turn that
 * produced neither reports its redaction or its error instead.
 */
function renderReplySide({ assistantText, turn }: ParsedTurn<ConversationTurnSource>): {
  kind: "assistant" | "error";
  markdown: string;
} | null {
  const assistantMarkdown = assistantText || turn.output;
  if (assistantMarkdown) {
    return {
      kind: "assistant",
      markdown: ["**Assistant:**", "", assistantMarkdown].join("\n"),
    };
  }
  if (turn.outputRedacted) {
    return {
      kind: "assistant",
      markdown: ["**Assistant:**", "", "_[Redacted]_"].join("\n"),
    };
  }
  if (turn.error) {
    return {
      kind: "error",
      markdown: ["**Error:**", "", "```", turn.error, "```"].join("\n"),
    };
  }
  return null;
}

/** Join chunks into a single markdown blob (clipboard / fallback). */
export function joinConversationMarkdown(chunks: ConversationMarkdownChunk[]): string {
  return chunks
    .map((chunk) => chunk.markdown)
    .join("\n\n")
    .trimEnd();
}

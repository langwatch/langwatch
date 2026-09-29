import { formatDuration, isoTimestamp } from "../trace-time-format.ts";
import { extractSystemText } from "../transcript/transcript-text-extraction.ts";
import {
  clipKeepingEnds,
  type ConversationDetail,
  type ConversationView,
  FULL_CONVERSATION_DETAIL,
  renderConversationSteps,
  renderToolLine,
} from "./conversation-steps.ts";
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
  detail = FULL_CONVERSATION_DETAIL,
  view = "conversation",
}: {
  conversationId: string;
  turns: ParsedTurn<ConversationTurnSource>[];
  /** How much of each turn's text and steps to keep; a budgeted render lowers it. */
  detail?: ConversationDetail;
  view?: ConversationView;
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
      markdown: [
        "## System",
        "",
        "```",
        clipKeepingEnds({ text: systemPrompt, maxChars: detail.turnTextChars }),
        "```",
      ].join("\n"),
    });
  }

  for (let i = 0; i < turns.length; i++) {
    chunks.push(...turnChunks({ parsed: turns[i]!, turnNumber: i + 1, detail, view }));
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
  detail,
  view,
}: {
  parsed: ParsedTurn<ConversationTurnSource>;
  turnNumber: number;
  detail: ConversationDetail;
  view: ConversationView;
}): ConversationMarkdownChunk[] {
  const { turn } = parsed;
  const model = turn.models[0] ? turn.models[0] : "—";
  const chunks: ConversationMarkdownChunk[] = [
    {
      id: `turn-${turnNumber}-header`,
      turnNumber,
      // An absolute time, so the same thread renders the same text on any day.
      markdown: `## Turn ${turnNumber} · ${isoTimestamp(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    },
  ];

  const user = renderUserSide({ parsed, maxChars: detail.turnTextChars });
  if (user) {
    chunks.push({ id: `turn-${turnNumber}-user`, turnNumber, markdown: user });
  }
  const steps =
    view === "steps"
      ? renderConversationSteps({ steps: turn.steps ?? [], detail })
      : renderToolLine({ steps: turn.steps ?? [] });
  if (steps) {
    chunks.push({ id: `turn-${turnNumber}-steps`, turnNumber, markdown: steps });
  }
  const reply = renderReplySide({ parsed, maxChars: detail.turnTextChars });
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
function renderUserSide({
  parsed: { userText, turn },
  maxChars,
}: {
  parsed: ParsedTurn<ConversationTurnSource>;
  maxChars: number;
}): string | null {
  if (userText) return ["**User:**", "", clipKeepingEnds({ text: userText, maxChars })].join("\n");
  if (turn.inputRedacted) return ["**User:**", "", "_[Redacted]_"].join("\n");
  return null;
}

/**
 * The reply side of a turn, or nothing when it recorded none. The extracted
 * prose wins, raw output is the fallback for a tool-only turn, and a turn that
 * produced neither reports its redaction or its error instead.
 */
function renderReplySide({
  parsed: { assistantText, turn },
  maxChars,
}: {
  parsed: ParsedTurn<ConversationTurnSource>;
  maxChars: number;
}): {
  kind: "assistant" | "error";
  markdown: string;
} | null {
  const assistantMarkdown = assistantText || turn.output;
  if (assistantMarkdown) {
    return {
      kind: "assistant",
      markdown: ["**Assistant:**", "", clipKeepingEnds({ text: assistantMarkdown, maxChars })].join(
        "\n",
      ),
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

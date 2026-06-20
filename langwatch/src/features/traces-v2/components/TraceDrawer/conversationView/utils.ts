import {
  abbreviateModel,
  formatDuration,
  formatRelativeTime,
} from "../../../utils/formatters";
import { extractSystemText } from "../transcript/parsing";
import type { ParsedTurn } from "./types";

export interface ConversationMarkdownChunk {
  /** Stable key for the virtualizer. */
  id: string;
  /** Markdown source for this chunk. */
  markdown: string;
}

/**
 * Build the conversation markdown as a list of independently-renderable
 * chunks. The MarkdownConversationView mounts one `<RenderedMarkdown>` per
 * chunk through a virtualizer, so very long conversations only pay the
 * react-markdown / Shiki cost for what's actually on screen. Chunking is
 * intentionally finer than per-turn — the user prompt and the assistant
 * answer for a single turn each get their own chunk so a single huge
 * assistant response doesn't pin a giant row in memory.
 *
 * The Copy button still hands back the full string via
 * `joinConversationMarkdown(chunks)` so paste-as-one-doc keeps working.
 */
export function buildConversationMarkdownChunks(
  conversationId: string,
  parsedTurns: ParsedTurn[],
): ConversationMarkdownChunk[] {
  const chunks: ConversationMarkdownChunk[] = [];

  const headerLines: string[] = [`# Conversation \`${conversationId}\``, ""];
  headerLines.push(`- **Turns:** ${parsedTurns.length}`);
  if (parsedTurns.length > 0) {
    const first = parsedTurns[0]!.turn;
    const last = parsedTurns[parsedTurns.length - 1]!.turn;
    headerLines.push(
      `- **Started:** ${new Date(first.timestamp).toISOString()}`,
    );
    headerLines.push(
      `- **Last turn:** ${new Date(last.timestamp).toISOString()}`,
    );
    let totalCost = 0;
    let totalTokens = 0;
    for (const p of parsedTurns) {
      totalCost += p.turn.totalCost ?? 0;
      totalTokens += p.turn.totalTokens;
    }
    if (totalCost > 0) {
      headerLines.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
    }
    if (totalTokens > 0) headerLines.push(`- **Total tokens:** ${totalTokens}`);
  }
  chunks.push({ id: "header", markdown: headerLines.join("\n") });

  // System prompt gets its own chunk — long system prompts can dwarf the
  // conversation itself, and isolating them keeps the preamble cheap and
  // the prompt unmounted until scrolled to.
  const systemPrompt = extractSystemText(parsedTurns[0]?.turn.input);
  if (systemPrompt) {
    chunks.push({
      id: "system",
      markdown: ["## System", "", "```", systemPrompt, "```"].join("\n"),
    });
  }

  for (let i = 0; i < parsedTurns.length; i++) {
    const { turn, userText, assistantText } = parsedTurns[i]!;
    const turnNum = i + 1;
    const model = turn.models[0] ? abbreviateModel(turn.models[0]) : "—";
    chunks.push({
      id: `turn-${turnNum}-header`,
      markdown: `## Turn ${turnNum} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    });
    if (userText) {
      chunks.push({
        id: `turn-${turnNum}-user`,
        markdown: ["**User:**", "", userText].join("\n"),
      });
    }
    // Prefer the pre-extracted assistant prose (same as the bubble) — it
    // strips Anthropic `{type:"thinking"|"tool_use"}` envelopes. Fall back
    // to raw output only when there's no extractable text (e.g. a tool-only
    // turn), rather than dumping JSON for the common text case.
    const assistantMarkdown = assistantText || turn.output;
    if (assistantMarkdown) {
      chunks.push({
        id: `turn-${turnNum}-assistant`,
        markdown: ["**Assistant:**", "", assistantMarkdown].join("\n"),
      });
    } else if (turn.error) {
      chunks.push({
        id: `turn-${turnNum}-error`,
        markdown: ["**Error:**", "", "```", turn.error, "```"].join("\n"),
      });
    }
  }

  return chunks;
}

/** Join chunks into a single markdown blob (clipboard / fallback). */
export function joinConversationMarkdown(
  chunks: ConversationMarkdownChunk[],
): string {
  return chunks
    .map((c) => c.markdown)
    .join("\n\n")
    .trimEnd();
}

export function formatGap(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s gap`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}m ${s}s gap`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m gap`;
}

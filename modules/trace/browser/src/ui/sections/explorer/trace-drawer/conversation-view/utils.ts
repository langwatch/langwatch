import type { TraceMediaRef } from "@langwatch/trace-contract";
import {
  mediaRefBelongsToSide,
  mediaRoleBelongsToSide,
  type TraceMediaSide,
} from "../../../../../behavior/shared/traces/media-refs.ts";
import {
  collectAnnotatedMediaParts,
  type MediaPartData,
  mediaRefToMediaData,
} from "../../../../../behavior/shared/traces/media-parts.ts";
import { formatDuration, formatRelativeTime,readableDate } from "../../../../../model/display-formatters.ts";
import { extractSystemText } from "../transcript/parsing.ts";
import type { ParsedTurn } from "./types.ts";

/** Shared empty list so a media-free turn keeps a stable identity per parse. */
const NO_MEDIA: MediaPartData[] = [];

/**
 * The media that hangs off one side of a turn's messages.
 */
export function turnMediaForSide({
  refs,
  value,
  side,
}: {
  refs: TraceMediaRef[] | undefined;
  value: string | null | undefined;
  side: TraceMediaSide;
}): MediaPartData[] {
  if (refs && refs.length > 0) {
    const fromRefs = refs
      .filter((ref) => mediaRefBelongsToSide(ref, side))
      .map(mediaRefToMediaData);
    return fromRefs.length > 0 ? fromRefs : NO_MEDIA;
  }
  const collected = collectAnnotatedMediaParts(value)
    .filter((part) => mediaRoleBelongsToSide(part.role, side))
    .map((part) => part.media);
  return collected.length > 0 ? collected : NO_MEDIA;
}

export interface ConversationMarkdownChunk {
  /** Stable key for the virtualizer. */
  id: string;
  /** Markdown source for this chunk. */
  markdown: string;
}

function buildConversationHeader(
  conversationId: string,
  parsedTurns: ParsedTurn[],
): ConversationMarkdownChunk {
  const headerLines: string[] = [
    conversationId ? `# Conversation \`${conversationId}\`` : "# Conversation",
    "",
  ];
  headerLines.push(`- **Turns:** ${parsedTurns.length}`);
  if (parsedTurns.length === 0) return { id: "header", markdown: headerLines.join("\n") };

  const first = parsedTurns[0]!.turn;
  const last = parsedTurns[parsedTurns.length - 1]!.turn;
  headerLines.push(`- **Started:** ${readableDate(first.timestamp).toISOString()}`);
  headerLines.push(`- **Last turn:** ${readableDate(last.timestamp).toISOString()}`);

  let totalCost = 0;
  let totalTokens = 0;
  for (const parsed of parsedTurns) {
    totalCost += parsed.turn.totalCost ?? 0;
    totalTokens += parsed.turn.totalTokens;
  }
  if (totalCost > 0) headerLines.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
  if (totalTokens > 0) headerLines.push(`- **Total tokens:** ${totalTokens}`);

  return { id: "header", markdown: headerLines.join("\n") };
}

function appendTurnChunks(chunks: ConversationMarkdownChunk[], parsedTurns: ParsedTurn[]): void {
  for (let index = 0; index < parsedTurns.length; index++) {
    const { turn, userText, assistantText } = parsedTurns[index]!;
    const turnNum = index + 1;
    const model = turn.models[0] ? turn.models[0] : "—";
    chunks.push({
      id: `turn-${turnNum}-header`,
      markdown: `## Turn ${turnNum} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    });

    if (userText) {
      chunks.push({
        id: `turn-${turnNum}-user`,
        markdown: ["**User:**", "", userText].join("\n"),
      });
    } else if (turn.inputRedacted) {
      chunks.push({
        id: `turn-${turnNum}-user`,
        markdown: ["**User:**", "", "_[Redacted]_"].join("\n"),
      });
    }

    const assistantMarkdown = assistantText || turn.output;
    if (assistantMarkdown) {
      chunks.push({
        id: `turn-${turnNum}-assistant`,
        markdown: ["**Assistant:**", "", assistantMarkdown].join("\n"),
      });
    } else if (turn.outputRedacted) {
      chunks.push({
        id: `turn-${turnNum}-assistant`,
        markdown: ["**Assistant:**", "", "_[Redacted]_"].join("\n"),
      });
    } else if (turn.error) {
      chunks.push({
        id: `turn-${turnNum}-error`,
        markdown: ["**Error:**", "", "```", turn.error, "```"].join("\n"),
      });
    }
  }
}

/**
 * Build the conversation markdown as a list of independently-renderable chunks.
 */
export function buildConversationMarkdownChunks(
  conversationId: string,
  parsedTurns: ParsedTurn[],
): ConversationMarkdownChunk[] {
  const chunks: ConversationMarkdownChunk[] = [
    buildConversationHeader(conversationId, parsedTurns),
  ];

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

  appendTurnChunks(chunks, parsedTurns);

  return chunks;
}

/** Join chunks into a single markdown blob (clipboard / fallback). */
export function joinConversationMarkdown(chunks: ConversationMarkdownChunk[]): string {
  return chunks
    .map((c) => c.markdown)
    .join("\n\n")
    .trimEnd();
}

/**
 * Human-readable wall-clock gap between two turns, e.g. "12.5s gap",
 * "3m 4s gap", "1h 2m gap". Surfaces how long the user was away between turns.
 */
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

import { formatDuration, formatRelativeTime } from "~/shared/format/time";
import {
  cutToEstimatedTokens,
  estimateTokensFromBytes,
} from "~/shared/traces/tokenBudget";
import { extractSystemText } from "~/shared/traces/transcript/parsing";
import type { ConversationTurnSource, ParsedTurn } from "./parsedTurns";

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
 * Build the conversation markdown as a list of independently-renderable
 * chunks. The MarkdownConversationView mounts one `<RenderedMarkdown>` per
 * chunk through a virtualizer, so very long conversations only pay the
 * react-markdown / Shiki cost for what's actually on screen. Chunking is
 * intentionally finer than per-turn — the user prompt and the assistant
 * answer for a single turn each get their own chunk so a single huge
 * assistant response doesn't pin a giant row in memory.
 *
 * The Copy button still hands back the full string via
 * `joinConversationMarkdown(chunks)` so paste-as-one-doc keeps working, and
 * `renderConversationMarkdown` folds the same chunks into one string under a
 * token budget for a reader that is a model rather than a person.
 */
export function buildConversationMarkdownChunks({
  conversationId,
  turns,
}: {
  conversationId: string;
  turns: ParsedTurn<ConversationTurnSource>[];
}): ConversationMarkdownChunk[] {
  const chunks: ConversationMarkdownChunk[] = [];

  // A threadless trace has no conversation id to name; the heading stands on
  // its own rather than trailing an empty pair of backticks.
  const headerLines: string[] = [
    conversationId ? `# Conversation \`${conversationId}\`` : "# Conversation",
    "",
  ];
  headerLines.push(`- **Turns:** ${turns.length}`);
  if (turns.length > 0) {
    const first = turns[0]!.turn;
    const last = turns[turns.length - 1]!.turn;
    headerLines.push(
      `- **Started:** ${new Date(first.timestamp).toISOString()}`,
    );
    headerLines.push(
      `- **Last turn:** ${new Date(last.timestamp).toISOString()}`,
    );
    let totalCost = 0;
    let totalTokens = 0;
    for (const p of turns) {
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
  const systemPrompt = extractSystemText(turns[0]?.turn.input);
  if (systemPrompt) {
    chunks.push({
      id: "system",
      markdown: ["## System", "", "```", systemPrompt, "```"].join("\n"),
    });
  }

  for (let i = 0; i < turns.length; i++) {
    const { turn, userText, assistantText } = turns[i]!;
    const turnNumber = i + 1;
    const model = turn.models[0] ? turn.models[0] : "—";
    chunks.push({
      id: `turn-${turnNumber}-header`,
      turnNumber,
      markdown: `## Turn ${turnNumber} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    });
    // Redaction is enforced server-side (content is nulled before it
    // reaches the client when the project's redaction policy fires). The
    // bubble view shows `[Redacted]` in place of the text; the markdown
    // export must do the same — silently dropping the turn would make
    // pasted transcripts look like the turn never happened.
    if (userText) {
      chunks.push({
        id: `turn-${turnNumber}-user`,
        turnNumber,
        markdown: ["**User:**", "", userText].join("\n"),
      });
    } else if (turn.inputRedacted) {
      chunks.push({
        id: `turn-${turnNumber}-user`,
        turnNumber,
        markdown: ["**User:**", "", "_[Redacted]_"].join("\n"),
      });
    }
    // Prefer the pre-extracted assistant prose (same as the bubble) — it
    // strips Anthropic `{type:"thinking"|"tool_use"}` envelopes. Fall back
    // to raw output only when there's no extractable text (e.g. a tool-only
    // turn), rather than dumping JSON for the common text case.
    const assistantMarkdown = assistantText || turn.output;
    if (assistantMarkdown) {
      chunks.push({
        id: `turn-${turnNumber}-assistant`,
        turnNumber,
        markdown: ["**Assistant:**", "", assistantMarkdown].join("\n"),
      });
    } else if (turn.outputRedacted) {
      chunks.push({
        id: `turn-${turnNumber}-assistant`,
        turnNumber,
        markdown: ["**Assistant:**", "", "_[Redacted]_"].join("\n"),
      });
    } else if (turn.error) {
      chunks.push({
        id: `turn-${turnNumber}-error`,
        turnNumber,
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

/**
 * Share of the turn budget spent on the start of the conversation when the
 * whole thing does not fit. The opening turns say what the conversation is
 * about, but what a reader is judging almost always happened at the end, so
 * the tail gets the larger share.
 */
const HEAD_BUDGET_SHARE = 0.25;

const omittedMarker = (count: number): string =>
  `_[${count} ${count === 1 ? "turn" : "turns"} omitted to fit the token budget]_`;

const TRUNCATED_MARKER = "_[truncated to fit the token budget]_";

export interface RenderedConversationMarkdown {
  /** The markdown, cut to the budget when one was given. */
  text: string;
  /** Whether anything was dropped to fit the budget. */
  truncated: boolean;
  estimatedTokens: number;
  /** How many whole turns were dropped from the middle. */
  omittedTurns: number;
}

/**
 * Render a parsed conversation as one markdown string, optionally under a
 * token budget.
 *
 * Without `maxTokens` this is the drawer's Copy output. With one, the
 * conversation preamble is always kept, turns are kept from both ends until
 * the budget runs out, and the gap between them carries a marker naming how
 * many turns are missing, because a reader must never mistake a cut
 * conversation for a short one. A single turn too large for the budget on its
 * own is cut mid-turn with the same kind of marker.
 */
export function renderConversationMarkdown({
  conversationId = "",
  turns,
  maxTokens,
}: {
  conversationId?: string;
  turns: ParsedTurn<ConversationTurnSource>[];
  maxTokens?: number;
}): RenderedConversationMarkdown {
  const chunks = buildConversationMarkdownChunks({ conversationId, turns });
  const full = joinConversationMarkdown(chunks);
  const fullTokens = estimateTokensFromBytes(full);
  if (maxTokens === undefined || fullTokens <= maxTokens) {
    return {
      text: full,
      truncated: false,
      estimatedTokens: fullTokens,
      omittedTurns: 0,
    };
  }

  const preamble = chunks.filter((c) => c.turnNumber === undefined);
  const turnGroups = groupByTurn(chunks);
  const preambleTokens = estimateTokensFromBytes(
    joinConversationMarkdown(preamble),
  );
  // Reserve the marker up front, at the length it takes for every turn being
  // dropped, so adding it can never be what pushes the result over budget.
  const markerTokens = estimateTokensFromBytes(
    omittedMarker(turnGroups.length),
  );
  const available = maxTokens - preambleTokens - markerTokens;

  const kept = new Set<number>();
  if (available > 0) {
    const headBudget = Math.floor(available * HEAD_BUDGET_SHARE);
    let spent = 0;
    for (let i = 0; i < turnGroups.length; i++) {
      const cost = turnGroups[i]!.tokens;
      if (spent + cost > headBudget) break;
      spent += cost;
      kept.add(i);
    }
    // Whatever the head did not spend rolls into the tail rather than being
    // thrown away: a conversation whose first turn is enormous should still
    // show as much of the end as the whole budget allows.
    let tailSpent = 0;
    const tailBudget = available - spent;
    for (let i = turnGroups.length - 1; i >= 0; i--) {
      if (kept.has(i)) break;
      const cost = turnGroups[i]!.tokens;
      if (tailSpent + cost > tailBudget) break;
      tailSpent += cost;
      kept.add(i);
    }
  }

  const omittedTurns = turnGroups.length - kept.size;
  const assembled: ConversationMarkdownChunk[] = [...preamble];
  let markerWritten = false;
  for (let i = 0; i < turnGroups.length; i++) {
    if (kept.has(i)) {
      assembled.push(...turnGroups[i]!.chunks);
      continue;
    }
    if (!markerWritten) {
      assembled.push({
        id: "omitted",
        markdown: omittedMarker(omittedTurns),
      });
      markerWritten = true;
    }
  }

  const text = joinConversationMarkdown(assembled);
  const tokens = estimateTokensFromBytes(text);
  if (tokens <= maxTokens) {
    return { text, truncated: true, estimatedTokens: tokens, omittedTurns };
  }

  // Nothing fit whole: keep the opening of what we assembled and say so.
  const markerCost = estimateTokensFromBytes(`\n\n${TRUNCATED_MARKER}`);
  const cut = `${cutToEstimatedTokens({
    text,
    maxTokens: Math.max(0, maxTokens - markerCost),
  }).trimEnd()}\n\n${TRUNCATED_MARKER}`;
  return {
    text: cut,
    truncated: true,
    estimatedTokens: estimateTokensFromBytes(cut),
    omittedTurns,
  };
}

interface TurnChunkGroup {
  chunks: ConversationMarkdownChunk[];
  tokens: number;
}

/** The chunks of each turn, in turn order, with what each turn costs. */
function groupByTurn(chunks: ConversationMarkdownChunk[]): TurnChunkGroup[] {
  const byTurn = new Map<number, ConversationMarkdownChunk[]>();
  for (const chunk of chunks) {
    if (chunk.turnNumber === undefined) continue;
    const existing = byTurn.get(chunk.turnNumber);
    if (existing) existing.push(chunk);
    else byTurn.set(chunk.turnNumber, [chunk]);
  }
  return [...byTurn.keys()]
    .sort((a, b) => a - b)
    .map((turnNumber) => {
      const group = byTurn.get(turnNumber)!;
      return {
        chunks: group,
        tokens: estimateTokensFromBytes(joinConversationMarkdown(group)),
      };
    });
}

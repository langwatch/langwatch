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
  const chunks: ConversationMarkdownChunk[] = [
    { id: "header", markdown: conversationHeader({ conversationId, turns }) },
  ];

  // System prompt gets its own chunk: long system prompts can dwarf the
  // conversation itself, and isolating them keeps the preamble cheap and the
  // prompt unmounted until scrolled to.
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
  // A threadless trace has no conversation id to name; the heading stands on
  // its own rather than trailing an empty pair of backticks.
  const lines: string[] = [
    conversationId ? `# Conversation \`${conversationId}\`` : "# Conversation",
    "",
    `- **Turns:** ${turns.length}`,
  ];
  const first = turns[0]?.turn;
  const last = turns[turns.length - 1]?.turn;
  if (!first || !last) return lines.join("\n");

  lines.push(`- **Started:** ${new Date(first.timestamp).toISOString()}`);
  lines.push(`- **Last turn:** ${new Date(last.timestamp).toISOString()}`);
  let totalCost = 0;
  let totalTokens = 0;
  for (const p of turns) {
    totalCost += p.turn.totalCost ?? 0;
    totalTokens += p.turn.totalTokens;
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

  const user = userSide(parsed);
  if (user) {
    chunks.push({ id: `turn-${turnNumber}-user`, turnNumber, markdown: user });
  }
  const reply = replySide(parsed);
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
 * The user side of a turn, or nothing when the turn recorded none.
 *
 * Redaction is enforced server-side (content is nulled before it reaches the
 * client when the project's redaction policy fires). The bubble view shows
 * `[Redacted]` in place of the text and the markdown export must do the same:
 * silently dropping the turn would make pasted transcripts look like the turn
 * never happened.
 */
function userSide({
  userText,
  turn,
}: ParsedTurn<ConversationTurnSource>): string | null {
  if (userText) return ["**User:**", "", userText].join("\n");
  if (turn.inputRedacted) {
    return ["**User:**", "", "_[Redacted]_"].join("\n");
  }
  return null;
}

/**
 * The reply side of a turn, or nothing when the turn recorded none.
 *
 * Prefers the pre-extracted assistant prose (same as the bubble), which
 * strips Anthropic `{type:"thinking"|"tool_use"}` envelopes. Raw output is the
 * fallback for a turn with no extractable text (a tool-only turn), rather than
 * dumping JSON for the common text case. A turn that produced neither reports
 * its redaction or its error instead.
 */
function replySide({
  assistantText,
  turn,
}: ParsedTurn<ConversationTurnSource>): {
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
  // Reserve the marker up front, at the length it takes for every turn being
  // dropped, so adding it can never be what pushes the result over budget.
  const available =
    maxTokens -
    estimateTokensFromBytes(joinConversationMarkdown(preamble)) -
    estimateTokensFromBytes(omittedMarker(turnGroups.length));
  const kept = keepWithinBudget({ turnGroups, available });

  const omittedTurns = turnGroups.length - kept.size;
  if (kept.size === 0 && turnGroups.length > 0) {
    return renderFinalTurnCut({ preamble, turnGroups, maxTokens });
  }

  const text = joinConversationMarkdown(
    assembleKeptTurns({ preamble, turnGroups, kept, omittedTurns }),
  );
  const tokens = estimateTokensFromBytes(text);
  if (tokens <= maxTokens) {
    return { text, truncated: true, estimatedTokens: tokens, omittedTurns };
  }
  return cutWholeText({ text, maxTokens, omittedTurns });
}

/**
 * The render for a budget no single turn fits inside: the preamble, then as
 * much of the final turn as is left over, cut mid-turn.
 *
 * The end of a conversation is what a reader is judging, and a heading with no
 * conversation under it answers nothing, so the leftover budget is spent on
 * text rather than handed back. When not even the preamble and a marker fit,
 * there is nothing to spend it on and the preamble itself is what gets cut.
 */
function renderFinalTurnCut({
  preamble,
  turnGroups,
  maxTokens,
}: {
  preamble: ConversationMarkdownChunk[];
  turnGroups: TurnChunkGroup[];
  maxTokens: number;
}): RenderedConversationMarkdown {
  const preambleText = joinConversationMarkdown(preamble);
  // The separator before the opening is part of the render, so it is reserved
  // alongside the preamble and the marker or the result overshoots by a token.
  const spare =
    maxTokens -
    estimateTokensFromBytes(preambleText) -
    estimateTokensFromBytes("\n\n") -
    estimateTokensFromBytes(`\n\n${TRUNCATED_MARKER}`);
  const finalTurn = turnGroups[turnGroups.length - 1]!;
  const opening =
    spare > 0
      ? cutToEstimatedTokens({
          text: joinConversationMarkdown(finalTurn.chunks),
          maxTokens: spare,
        }).trimEnd()
      : "";
  if (!opening) {
    return cutWholeText({
      text: preambleText,
      maxTokens,
      omittedTurns: turnGroups.length,
    });
  }
  const text = `${preambleText}\n\n${opening}\n\n${TRUNCATED_MARKER}`;
  return {
    text,
    truncated: true,
    estimatedTokens: estimateTokensFromBytes(text),
    // The final turn is on the page, cut rather than dropped, so it is not
    // among the whole turns that went missing from the middle.
    omittedTurns: turnGroups.length - 1,
  };
}

/**
 * The last resort: cut the text itself to the budget. A budget too small to
 * hold the marker gets the cut text alone, because the budget is the promise
 * being kept.
 */
function cutWholeText({
  text,
  maxTokens,
  omittedTurns,
}: {
  text: string;
  maxTokens: number;
  omittedTurns: number;
}): RenderedConversationMarkdown {
  const markerCost = estimateTokensFromBytes(`\n\n${TRUNCATED_MARKER}`);
  const body = cutToEstimatedTokens({
    text,
    maxTokens: maxTokens - markerCost,
  }).trimEnd();
  const cut = body
    ? `${body}\n\n${TRUNCATED_MARKER}`
    : cutToEstimatedTokens({ text, maxTokens });
  return {
    text: cut,
    truncated: true,
    estimatedTokens: estimateTokensFromBytes(cut),
    omittedTurns,
  };
}

/**
 * Which turns to keep: as many from the start as `HEAD_BUDGET_SHARE` of the
 * budget buys, then as many from the end as the rest buys.
 *
 * Whatever the head does not spend rolls into the tail rather than being
 * thrown away, so a conversation whose first turn is enormous still shows as
 * much of the end as the whole budget allows.
 */
function keepWithinBudget({
  turnGroups,
  available,
}: {
  turnGroups: TurnChunkGroup[];
  available: number;
}): Set<number> {
  const kept = new Set<number>();
  if (available <= 0) return kept;
  const headSpent = takeFromHead({ turnGroups, available, kept });
  takeFromTail({ turnGroups, budget: available - headSpent, kept });
  return kept;
}

/**
 * Turns taken from the start, and what they cost.
 *
 * `HEAD_BUDGET_SHARE` is a share, not a cap: one turn bigger than the share
 * would otherwise starve the opening entirely, and the opening is what says
 * what the conversation is about. So the first turn is kept whenever the
 * budget as a whole can afford it.
 */
function takeFromHead({
  turnGroups,
  available,
  kept,
}: {
  turnGroups: TurnChunkGroup[];
  available: number;
  kept: Set<number>;
}): number {
  const headBudget = Math.floor(available * HEAD_BUDGET_SHARE);
  let spent = 0;
  for (const [index, group] of turnGroups.entries()) {
    if (spent + group.tokens > headBudget) break;
    spent += group.tokens;
    kept.add(index);
  }
  if (kept.size > 0) return spent;

  const first = turnGroups[0];
  if (first && first.tokens <= available) {
    kept.add(0);
    return first.tokens;
  }
  return 0;
}

/**
 * Turns taken from the end, with whatever the head did not spend. Stops at the
 * first turn the head already kept, so the two selections never overlap.
 */
function takeFromTail({
  turnGroups,
  budget,
  kept,
}: {
  turnGroups: TurnChunkGroup[];
  budget: number;
  kept: Set<number>;
}): void {
  let spent = 0;
  for (let i = turnGroups.length - 1; i >= 0; i--) {
    if (kept.has(i)) break;
    if (spent + turnGroups[i]!.tokens > budget) break;
    spent += turnGroups[i]!.tokens;
    kept.add(i);
  }
}

function assembleKeptTurns({
  preamble,
  turnGroups,
  kept,
  omittedTurns,
}: {
  preamble: ConversationMarkdownChunk[];
  turnGroups: TurnChunkGroup[];
  kept: Set<number>;
  omittedTurns: number;
}): ConversationMarkdownChunk[] {
  const assembled: ConversationMarkdownChunk[] = [...preamble];
  let markerWritten = false;
  for (let i = 0; i < turnGroups.length; i++) {
    if (kept.has(i)) {
      assembled.push(...turnGroups[i]!.chunks);
    } else if (!markerWritten) {
      assembled.push({ id: "omitted", markdown: omittedMarker(omittedTurns) });
      markerWritten = true;
    }
  }
  return assembled;
}

interface TurnChunkGroup {
  chunks: ConversationMarkdownChunk[];
  tokens: number;
}

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

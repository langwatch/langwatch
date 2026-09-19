/**
 * The conversation markdown under a token budget, for a reader that is a
 * model rather than a person. Chunk construction and formatting stay in
 * `./conversationMarkdown`; this module only decides what survives the cut.
 */
import {
  cutToEstimatedTokens,
  estimateTokensFromBytes,
} from "~/shared/traces/tokenBudget";
import {
  buildConversationMarkdownChunks,
  type ConversationMarkdownChunk,
  joinConversationMarkdown,
} from "./conversationMarkdown";
import type { ConversationTurnSource, ParsedTurn } from "./parsedTurns";

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
  isTruncated: boolean;
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
      isTruncated: false,
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
    return { text, isTruncated: true, estimatedTokens: tokens, omittedTurns };
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
    isTruncated: true,
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
    isTruncated: true,
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

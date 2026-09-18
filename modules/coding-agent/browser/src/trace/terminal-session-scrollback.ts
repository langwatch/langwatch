import type { TranscriptEntry } from "@langwatch/coding-agent-contract";

import type { TerminalToolSpan } from "./terminal-tool-spans.ts";

export const CONVERSATION_TURN_CAP = 200;

export type ScrollbackStatus =
  | "pending"
  | "hidden"
  | "available"
  | "loading"
  | "error"
  | "start"
  | "unavailable";

export type EarlierTotals = {
  tokens: number | null;
  costUsd: number | null;
};

/**
 * Merges multiple session turns (oldest first) into one transcript; arithmetic
 * (order, row identity, turn boundaries) handled away from React.
 */

/** One turn of the session, as read. */
export interface LoadedTurn {
  traceId: string;
  /** The turn's own trace timestamp, which is when the turn started. */
  timestamp: number;
  entries: TranscriptEntry[];
  toolSpans: ReadonlyMap<string, TerminalToolSpan>;
}

/**
 * The boundary between two turns. A decoration, deliberately NOT a transcript
 * entry: the transcript is what the agent did, and the step counter counts it.
 * A divider is drawn between beats and counts as none.
 */
export interface TurnDivider {
  /** 1-based position of the turn that STARTS here, within the session. */
  turnNumber: number;
  /** How many turns the session has in total. */
  turnCount: number;
  atMs: number;
}

export interface MergedSession {
  entries: TranscriptEntry[];
  /**
   * A stable identity per row, parallel to `entries`. Keyed by position, a
   * prepend would make every row inherit a different row's state — an
   * expanded system context would silently migrate onto someone else's line.
   */
  rowKeys: string[];
  toolSpans: ReadonlyMap<string, TerminalToolSpan>;
  /** Keyed by the entry index the turn starts at. */
  turnDividers: Map<number, TurnDivider>;
}

/**
 * Fold turns oldest-first into one transcript; `firstTurnNumber` allows dividers
 * to name turns by session position when partial.
 */
export function mergeSessionTurns(
  turns: readonly LoadedTurn[],
  { turnCount, firstTurnNumber }: { turnCount: number; firstTurnNumber: number },
): MergedSession {
  const entries: TranscriptEntry[] = [];
  const rowKeys: string[] = [];
  // Span ids are globally unique, so the union needs no per-turn namespacing.
  const toolSpans = new Map<string, TerminalToolSpan>();
  const turnDividers = new Map<number, TurnDivider>();

  turns.forEach((turn, turnIndex) => {
    for (const [spanId, span] of turn.toolSpans) toolSpans.set(spanId, span);

    // A turn whose transcript is empty still counts as a turn of the session
    // (its span ids are already folded in above), it just has no rows and so
    // no boundary to draw.
    if (turn.entries.length === 0) return;

    if (entries.length > 0) {
      turnDividers.set(entries.length, {
        turnNumber: firstTurnNumber + turnIndex,
        turnCount,
        atMs: turn.timestamp,
      });
    }

    turn.entries.forEach((entry, indexWithinTurn) => {
      entries.push(entry);
      rowKeys.push(`${turn.traceId}#${indexWithinTurn}`);
    });
  });

  return { entries, rowKeys, toolSpans, turnDividers };
}

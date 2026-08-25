import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import type { TerminalToolSpan } from "./toolSpans";

/**
 * A coding agent session is many traces, one per turn, and the Terminal tab
 * opens on ONE of them. Reading the session back means walking the session's
 * earlier turns and prepending them above the turn already on screen.
 *
 * Merging happens here, away from React, because it is arithmetic: which
 * entries end up in which order, what each row's stable identity is, and where
 * one turn ends and the next begins.
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
   * A stable identity per row, parallel to `entries`. React keys have to
   * survive a prepend: keyed by position, every row inherits the state of a
   * different row when earlier turns arrive above it, and an expanded system
   * context would silently migrate onto someone else's line.
   */
  rowKeys: string[];
  toolSpans: ReadonlyMap<string, TerminalToolSpan>;
  /** Keyed by the entry index the turn starts at. */
  turnDividers: Map<number, TurnDivider>;
}

/**
 * Fold the loaded turns, oldest first, into one transcript.
 *
 * `firstTurnNumber` is the session position of `turns[0]`, so the dividers can
 * say "turn 4 of 12" while only four turns are in memory. No divider is drawn
 * above the oldest loaded content: what sits there is either the top of the
 * session or the affordance to load more, and a rule above the first row would
 * claim a boundary that has nothing on the other side of it.
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

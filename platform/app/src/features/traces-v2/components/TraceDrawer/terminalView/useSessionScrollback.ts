import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { api } from "~/utils/api";
import {
  type ConversationTurn,
  useConversationContext,
} from "../../../hooks/useConversationContext";
import {
  type LoadedTurn,
  mergeSessionTurns,
  type TurnDivider,
} from "./sessionScrollback";
import { indexToolSpansBySpanId, type TerminalToolSpan } from "./toolSpans";

/**
 * How many turns `tracesV2.conversationContext` returns. A session longer than
 * this cannot be walked to its start, and the view says so rather than
 * pretending the oldest turn it can see is the beginning.
 */
export const CONVERSATION_TURN_CAP = 200;

/** Shared by every read of an earlier turn, matching the opened turn's own. */
const EARLIER_TURN_FETCH = { staleTime: 60_000 } as const;

/** The turn a read is asked for: its trace, and the partition hint. */
interface TurnTarget {
  traceId: string;
  timestamp: number;
}

/**
 * What the top of the screen is currently offering.
 *
 * - `pending`: the session's turn list is still being read, so whether
 *   anything sits above this turn is not yet known.
 * - `hidden`: the trace belongs to no session, so there is nothing above it.
 * - `available`: earlier turns exist and are ready to load.
 * - `loading`: one is being read.
 * - `error`: the read failed and can be retried.
 * - `start`: the oldest loaded turn is the session's first.
 * - `unavailable`: the session is longer than the turn list can reach.
 */
export type ScrollbackStatus =
  | "pending"
  | "hidden"
  | "available"
  | "loading"
  | "error"
  | "start"
  | "unavailable";

export interface SessionScrollback {
  entries: TranscriptEntry[];
  rowKeys: string[];
  toolSpans: ReadonlyMap<string, TerminalToolSpan>;
  turnDividers: ReadonlyMap<number, TurnDivider>;
  status: ScrollbackStatus;
  /** Turns of the session still older than the oldest one loaded. */
  earlierCount: number;
  /**
   * Totals of those unloaded earlier turns, from the session's turn list, so
   * the bottom bar can count the whole session up to the reader's position.
   * Loading a turn moves its share from here into the loaded entries, so the
   * sum the bar shows stays put. Null when the trace has no walkable session,
   * and a field is null when one of those turns does not carry it.
   */
  earlierTotals: EarlierTotals | null;
  /** When the session's first turn started; null without a walkable session. */
  sessionStartAtMs: number | null;
  loadEarlier: () => void;
}

/**
 * Read one turn of the session: its transcript, and the tool spans that carry
 * what its tools actually did. One commit or none, so the caller never has a
 * transcript on screen whose tool calls all read "(no output)" until their
 * spans catch up and rewrite every row under the reader.
 *
 * The transcript is the turn; its spans and events are enrichment, so a failed
 * span read leaves the turn readable rather than losing it.
 */
async function readTurn({
  utils,
  projectId,
  target,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  target: TurnTarget;
}): Promise<LoadedTurn> {
  const input = {
    projectId,
    traceId: target.traceId,
    occurredAtMs: target.timestamp,
  };
  const [transcript, spans, events] = await Promise.all([
    utils.tracesV2.codingAgentTranscript.fetch(input, EARLIER_TURN_FETCH),
    utils.tracesV2.spansFull.fetch(input, EARLIER_TURN_FETCH).catch(() => []),
    utils.tracesV2.traceEvents.fetch(input, EARLIER_TURN_FETCH).catch(() => []),
  ]);

  return {
    traceId: target.traceId,
    timestamp: target.timestamp,
    entries: transcript.entries,
    toolSpans: indexToolSpansBySpanId({ spans, events }),
  };
}

/** The turns in memory, and what the last read of one did. */
interface Ledger {
  /** Which trace of which session this ledger was built for. */
  key: string;
  /** Oldest first, all strictly older than the opened turn. */
  turns: LoadedTurn[];
  phase: "idle" | "loading" | "error";
}

/** The prior ledger when it was built for this key, else a fresh one. */
function ledgerFor(prev: Ledger, key: string): Ledger {
  return prev.key === key ? prev : { key, turns: [], phase: "idle" };
}

/**
 * What the top of the screen offers, from what is known about the session.
 * An opened turn the list does not carry has no history to walk: on a full
 * page that means the session runs past what the list reaches, otherwise the
 * trace simply has no siblings.
 *
 * The cap is only ever a question for that case. `conversationContext` reads
 * the session oldest-first from its first turn, so a listed turn always has
 * the session's real beginning at `turns[0]`, and walking back to it is the
 * start however long the session ran. What a full list can hide is the other
 * end: a turn past the cap is absent from the list entirely, which is why the
 * absent case, and only it, distinguishes "unavailable" from "hidden".
 */
function deriveStatus({
  hasSession,
  conversationId,
  turnCount,
  turnListLoading,
  phase,
  earlierCount,
}: {
  hasSession: boolean;
  conversationId: string | null;
  turnCount: number;
  /** The session's turn list read is still in flight. */
  turnListLoading: boolean;
  phase: Ledger["phase"];
  earlierCount: number;
}): ScrollbackStatus {
  if (!hasSession) {
    if (conversationId && turnListLoading) return "pending";
    return conversationId && turnCount >= CONVERSATION_TURN_CAP
      ? "unavailable"
      : "hidden";
  }
  if (phase === "loading") return "loading";
  if (phase === "error") return "error";
  return earlierCount === 0 ? "start" : "available";
}

/**
 * Read the target turn and commit it onto the ledger, unless the reader moved
 * to another trace while the read was in flight, in which case the resolution
 * belongs to a ledger that no longer exists and is dropped.
 */
async function loadTurnIntoLedger({
  utils,
  projectId,
  target,
  key,
  epoch,
  epochRef,
  setLedger,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  target: TurnTarget;
  key: string;
  epoch: number;
  epochRef: { current: number };
  setLedger: (update: (prev: Ledger) => Ledger) => void;
}): Promise<void> {
  try {
    const loaded = await readTurn({ utils, projectId, target });
    if (epochRef.current !== epoch) return;
    setLedger((prev) => ({
      key,
      turns: [loaded, ...ledgerFor(prev, key).turns],
      phase: "idle",
    }));
  } catch {
    if (epochRef.current !== epoch) return;
    setLedger((prev) => ({
      key,
      turns: ledgerFor(prev, key).turns,
      phase: "error",
    }));
  }
}

/**
 * The ledger of earlier turns for one opened trace, and the one way to grow
 * it. Owns the state, the in-flight guard and the epoch that drops reads
 * resolving after the reader moved to another trace.
 */
function useTurnLedger({
  key,
  projectId,
}: {
  key: string;
  projectId: string;
}): { current: Ledger; loadTurn: (target: TurnTarget) => void } {
  const utils = api.useUtils();
  const [ledger, setLedger] = useState<Ledger>(() => ({
    key,
    turns: [],
    phase: "idle",
  }));
  // A ledger built for another trace is not this trace's history. Ignoring it
  // here, rather than clearing it from an effect, keeps the wrong session's
  // turns from rendering for the frame before the effect runs.
  const current = useMemo<Ledger>(() => ledgerFor(ledger, key), [ledger, key]);

  // A read that resolves after the reader moved on belongs to a ledger that no
  // longer exists; it is dropped rather than committed onto the new one.
  const epochRef = useRef(0);
  useEffect(
    () => () => {
      epochRef.current += 1;
    },
    [key],
  );
  const inFlightRef = useRef(false);

  const loadTurn = useCallback(
    (target: TurnTarget) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const epoch = epochRef.current;
      setLedger((prev) => ({
        key,
        turns: ledgerFor(prev, key).turns,
        phase: "loading",
      }));
      void loadTurnIntoLedger({
        utils,
        projectId,
        target,
        key,
        epoch,
        epochRef,
        setLedger,
      }).finally(() => {
        inFlightRef.current = false;
      });
    },
    [utils, key, projectId],
  );

  return { current, loadTurn };
}

/**
 * The loaded turns and the opened one, merged into the flat shape the view
 * renders. Memoized on exactly what the merge reads, so a scroll or status
 * change never rebuilds the rows.
 */
function useMergedTurns({
  current,
  opened,
  turnCount,
  firstTurnNumber,
}: {
  current: Ledger;
  opened: LoadedTurn;
  turnCount: number;
  firstTurnNumber: number;
}) {
  return useMemo(
    () =>
      mergeSessionTurns([...current.turns, opened], {
        turnCount,
        firstTurnNumber,
      }),
    [current.turns, opened, turnCount, firstTurnNumber],
  );
}

/** What the tab knows about the turn it opened on. */
interface SessionScrollbackInput {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  /** The agent's session id, which is the conversation these turns share. */
  conversationId: string | null;
  openedTranscript: TranscriptEntry[];
  openedToolSpans: ReadonlyMap<string, TerminalToolSpan>;
}

/**
 * Where the opened turn sits in the session, and how far back the loaded
 * window already reaches.
 *
 * A turn the session does not list is a turn with no history to walk, so it
 * has no position and nothing above it, whatever the ledger holds.
 */
function useSessionPosition({
  turns,
  traceId,
  conversationId,
  loadedCount,
}: {
  turns: ConversationTurn[];
  traceId: string;
  conversationId: string | null;
  /** Earlier turns already on the ledger. */
  loadedCount: number;
}): { openedIndex: number; hasSession: boolean; oldestLoadedIndex: number } {
  const openedIndex = useMemo(
    () => turns.findIndex((turn) => turn.traceId === traceId),
    [turns, traceId],
  );
  const hasSession = Boolean(conversationId) && openedIndex >= 0;
  return {
    openedIndex,
    hasSession,
    oldestLoadedIndex: hasSession ? Math.max(openedIndex - loadedCount, 0) : 0,
  };
}

/**
 * The opened turn as a ledger entry, stable while its parts are, so the merge
 * below it does not rebuild on every render.
 */
function useOpenedTurn({
  traceId,
  timestamp,
  entries,
  toolSpans,
}: LoadedTurn): LoadedTurn {
  return useMemo(
    () => ({ traceId, timestamp, entries, toolSpans }),
    [traceId, timestamp, entries, toolSpans],
  );
}

/**
 * What the bottom bar counts from the turns above the loaded window. A field is
 * null when one of those turns does not carry it, which is not the same as
 * zero: the session total for that field cannot be stated at all, and the bar
 * leaves it out rather than reporting a sum that is short by the turns it could
 * not read. Cost is null for a reader without `cost:view`, since the turn list
 * carries no spend for them.
 */
export type EarlierTotals = {
  tokens: number | null;
  costUsd: number | null;
};

/**
 * The sum, or null when one of the values is absent. A turn that carries no
 * total is not a turn that counted for nothing, so a sum that skips it is not a
 * total at all.
 */
function sumOrNull(values: (number | null | undefined)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value == null) return null;
    sum += value;
  }
  return sum;
}

/**
 * Where the bottom bar counts from: the totals of the turns above the loaded
 * window, and the session's own start.
 *
 * Each turn's totals come from the session's turn list, so no transcript read
 * is needed, and loading a turn moves its share from this sum into the loaded
 * entries: the bar's total at a fixed position never moves.
 */
function useSessionBaseline({
  hasSession,
  turns,
  oldestLoadedIndex,
}: {
  hasSession: boolean;
  turns: ConversationTurn[];
  oldestLoadedIndex: number;
}): {
  earlierTotals: EarlierTotals | null;
  sessionStartAtMs: number | null;
} {
  const earlierTotals = useMemo(() => {
    if (!hasSession) return null;
    const earlier = turns.slice(0, oldestLoadedIndex);
    return {
      tokens: sumOrNull(earlier.map((turn) => turn.totalTokens)),
      costUsd: sumOrNull(earlier.map((turn) => turn.totalCost)),
    };
  }, [hasSession, turns, oldestLoadedIndex]);

  return {
    earlierTotals,
    sessionStartAtMs: hasSession ? (turns[0]?.timestamp ?? null) : null,
  };
}

/**
 * The session behind the opened turn, read backwards on demand.
 *
 * The opened turn is always the newest thing on screen and is never re-read
 * here: it arrives already loaded from the tab, and this hook only ever
 * prepends older turns to it.
 */
export function useSessionScrollback({
  projectId,
  traceId,
  occurredAtMs,
  conversationId,
  openedTranscript,
  openedToolSpans,
}: SessionScrollbackInput): SessionScrollback {
  const { turns, isLoading: turnListLoading } = useConversationContext(
    conversationId,
    traceId,
  );
  const key = `${projectId}|${traceId}|${conversationId ?? ""}`;
  const { current, loadTurn } = useTurnLedger({ key, projectId });

  const { openedIndex, hasSession, oldestLoadedIndex } = useSessionPosition({
    turns,
    traceId,
    conversationId,
    loadedCount: current.turns.length,
  });
  const earlierCount = oldestLoadedIndex;

  const status = deriveStatus({
    hasSession,
    conversationId,
    turnCount: turns.length,
    turnListLoading,
    phase: current.phase,
    earlierCount,
  });

  const opened = useOpenedTurn({
    traceId,
    timestamp:
      turns[openedIndex]?.timestamp ??
      occurredAtMs ??
      openedTranscript[0]?.atMs ??
      0,
    entries: openedTranscript,
    toolSpans: openedToolSpans,
  });

  const merged = useMergedTurns({
    current,
    opened,
    turnCount: turns.length,
    firstTurnNumber: oldestLoadedIndex + 1,
  });

  const { earlierTotals, sessionStartAtMs } = useSessionBaseline({
    hasSession,
    turns,
    oldestLoadedIndex,
  });

  const loadEarlier = useCallback(() => {
    if (!hasSession) return;
    const target = turns[oldestLoadedIndex - 1];
    if (!target) return;
    if (current.turns.some((turn) => turn.traceId === target.traceId)) return;
    loadTurn(target);
  }, [hasSession, oldestLoadedIndex, turns, current.turns, loadTurn]);

  return useMemo(
    () => ({
      ...merged,
      status,
      earlierCount,
      earlierTotals,
      sessionStartAtMs,
      loadEarlier,
    }),
    [
      merged,
      status,
      earlierCount,
      earlierTotals,
      sessionStartAtMs,
      loadEarlier,
    ],
  );
}

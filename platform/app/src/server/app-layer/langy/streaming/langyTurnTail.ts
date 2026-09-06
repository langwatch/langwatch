import { abortableDelay } from "./awaitTurnSettlement";
import type { LangyStreamEntry, LangyStreamRead } from "./langyTokenBuffer";
import type { SettlementOutcome, TurnHealth } from "./langyTurnSettlement";
import {
  advanceSettlement,
  NO_SETTLEMENT_STREAKS,
} from "./langyTurnSettlement";

/** How often the settlement watcher consults the durable fold + heartbeat. */
export const SETTLEMENT_POLL_MS = 5_000;
/**
 * Consecutive settled reads required before synthesizing a terminal, so a single
 * projection blip can never end a live stream.
 */
export const SETTLEMENT_CONFIRM_POLLS = 2;

/** The two reads a tail makes on the token buffer. */
export interface TurnTailBuffer {
  readTail(a: { conversationId: string; turnId: string }): Promise<{
    reads: LangyStreamRead[];
    lastId: string;
  }>;
  follow(a: {
    conversationId: string;
    turnId: string;
    fromId: string;
    signal?: AbortSignal;
  }): AsyncIterable<LangyStreamRead>;
}

/** One look at the durable fold and the per-turn heartbeat. */
type ReadTurnHealth = () => Promise<TurnHealth | null>;

/** Waits `ms`, and answers false when the signal aborted the wait. */
type Delay = (ms: number, signal: AbortSignal) => Promise<boolean>;

/**
 * Poll a turn's durable fold + per-turn heartbeat while its live edge is being
 * tailed, and resolve to what should end the tail — or null if the stream ended
 * first (aborted) or the turn is still going.
 *
 * Split out of the tail below so the tail stays at the orchestration level and
 * this confirmation loop is independently testable. The two gates themselves
 * live in `decideSyntheticTerminal` and `shouldAbandonWedgedTurn`; both want
 * the same reading confirmed over several polls, so a single blip can never end
 * a live stream.
 */
export async function watchForMissedTerminal({
  readHealth,
  signal,
  onAbandoned,
  pollMs = SETTLEMENT_POLL_MS,
  confirmPolls = SETTLEMENT_CONFIRM_POLLS,
  delay = abortableDelay,
}: {
  readHealth: ReadTurnHealth;
  signal: AbortSignal;
  /** Called with the streak that decided it, for the caller's log line. */
  onAbandoned?: (a: { stalePolls: number }) => void;
  pollMs?: number;
  confirmPolls?: number;
  delay?: Delay;
}): Promise<SettlementOutcome | null> {
  let streaks = NO_SETTLEMENT_STREAKS;
  while (!signal.aborted) {
    if (!(await delay(pollMs, signal))) return null;
    const next = advanceSettlement({
      health: await readHealth(),
      streaks,
      pollMs,
      confirmPolls,
    });
    streaks = next.streaks;
    if (next.outcome?.kind === "abandoned") {
      onAbandoned?.({ stalePolls: streaks.stale });
    }
    if (next.outcome) return next.outcome;
  }
  return null;
}

/** The entries a reader stops on: the turn is over, either way. */
const isTerminal = (entry: LangyStreamEntry): boolean =>
  entry.type === "end" || entry.type === "error";

/** What both halves of the tail need to reach the buffer and the fold. */
interface TailDeps {
  conversationId: string;
  turnId: string;
  buffer: TurnTailBuffer;
  readHealth: ReadTurnHealth;
  signal: AbortSignal;
  onAbandoned?: (a: { stalePolls: number }) => void;
  pollMs?: number;
  confirmPolls?: number;
  delay?: Delay;
}

/**
 * The live edge from `fromId` on, ending when the turn ends, the reader goes
 * away, or the turn is given up for wedged.
 *
 * A refresh mid-turn can miss the worker's terminal frame (its relay connection
 * dropped before it). follow() would then block until the reader goes away,
 * leaving the UI on the startup status for minutes though the turn already
 * finished. So while the live edge is tailed, the durable fold + per-turn
 * heartbeat are watched too; if the turn has settled with no terminal in the
 * buffer, one is synthesized so the client resolves.
 */
async function* followLiveEdge({
  fromId,
  conversationId,
  turnId,
  buffer,
  readHealth,
  signal,
  onAbandoned,
  pollMs,
  confirmPolls,
  delay,
}: TailDeps & { fromId: string }): AsyncGenerator<LangyStreamEntry> {
  const settle = new AbortController();
  const followSignal = AbortSignal.any([signal, settle.signal]);
  let synthesized: LangyStreamEntry | null = null;

  const watcher = watchForMissedTerminal({
    readHealth,
    signal: followSignal,
    onAbandoned,
    pollMs,
    confirmPolls,
    delay,
  })
    .then((outcome) => {
      // An abandoned turn yields nothing: we do not know how it ended, and
      // inventing a terminal for a turn that may still be alive would tell the
      // reader it finished when it did not.
      if (outcome?.kind === "terminal") synthesized = outcome.entry;
      if (outcome) settle.abort(); // unblock the follow() below
    })
    // Attached HERE, not in the finally below: follow() can block for minutes,
    // so a rejection would sit unhandled until then — and Node's default
    // --unhandled-rejections=throw would take the process down first. A failed
    // watcher just means no synthesized terminal.
    .catch(() => undefined);

  try {
    for await (const { entry } of buffer.follow({
      conversationId,
      turnId,
      fromId,
      signal: followSignal,
    })) {
      yield entry;
      // A real terminal reached the buffer. Returning here is what keeps a
      // synthesized one from ever overriding it: the yield below is past the
      // end of this generator.
      if (isTerminal(entry)) return;
    }
  } finally {
    settle.abort();
    await watcher; // already has its own .catch()
  }

  // follow() ended with no buffered terminal. If the watcher proved the turn
  // settled, deliver the synthesized terminal so the UI resolves instead of
  // hanging; the client reconciles the transcript via langy.messages.
  if (synthesized) yield synthesized;
}

/**
 * The live entries of one turn: the buffered prefix, then the live edge, until
 * the turn ends or the reader goes away.
 *
 * There is no deadline on the turn itself. The tail used to carry
 * `AbortSignal.timeout` on the manager's request budget, which capped every
 * live stream at two minutes. A turn that ran longer went deaf half-way
 * through — the panel kept the last thing it had heard on screen while the
 * agent worked on, and every UI action after the cap found nobody listening and
 * ran on the backend, so the whole second half of a loop arrived as one refetch
 * at the end. The wedged turn that deadline protected against is handled where
 * it can be recognised: the settlement watcher gives the tail up when the turn
 * stops beating, which is the real symptom.
 *
 * `release` runs when the tail ends for any reason, including the reader
 * walking away mid-turn. It is what gives the blocking Redis connection back.
 */
export async function* streamTurnEntries({
  release,
  ...deps
}: TailDeps & { release: () => void }): AsyncGenerator<LangyStreamEntry> {
  const { conversationId, turnId, buffer } = deps;
  try {
    // Drain the buffered prefix, then tail the live edge from where it ended.
    const { reads, lastId } = await buffer.readTail({ conversationId, turnId });
    for (const { entry } of reads) {
      yield entry;
      if (isTerminal(entry)) return;
    }
    yield* followLiveEdge({ ...deps, fromId: lastId });
  } finally {
    release();
  }
}

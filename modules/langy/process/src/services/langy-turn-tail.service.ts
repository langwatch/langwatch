import type { LangyStreamEntry } from "@langwatch/langy-contract";

import type { LangyStreamRead } from "../repositories/langy-token-buffer.repository.ts";
import type { SettlementOutcome, TurnHealth } from "../rules/langy-turn-settlement.rules.ts";
import { advanceSettlement, NO_SETTLEMENT_STREAKS } from "../rules/langy-turn-settlement.rules.ts";
import { LangyTurnSettlementWaiterService } from "./langy-turn-settlement-waiter.service.ts";

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
 * The live tail of one turn: what the reader sees, and the watchdog that ends
 * it when the turn stops beating.
 */
/** `stopped`: the stream ended (reader gone, real terminal seen) before any verdict. */
export type MissedTerminalWatch = SettlementOutcome | { kind: "stopped" };

const STOPPED: MissedTerminalWatch = { kind: "stopped" };

export class LangyTurnTailService {
  static create(): LangyTurnTailService {
    return new LangyTurnTailService();
  }

  private constructor() {}

  /**
   * Polls the turn's durable fold + per-turn heartbeat while its live edge is tailed, and
   * resolves to what should end the tail — or `stopped` when the stream ended first.
   */
  async watchForMissedTerminal({
    readHealth,
    signal,
    onAbandoned,
    pollMs = SETTLEMENT_POLL_MS,
    confirmPolls = SETTLEMENT_CONFIRM_POLLS,
    delay = (ms, signal) => LangyTurnSettlementWaiterService.create().abortableDelay(ms, signal),
  }: {
    readHealth: ReadTurnHealth;
    signal: AbortSignal;
    /** Called with the streak that decided it, for the caller's log line. */
    onAbandoned?: (a: { stalePolls: number }) => void;
    pollMs?: number;
    confirmPolls?: number;
    delay?: Delay;
  }): Promise<MissedTerminalWatch> {
    let streaks = NO_SETTLEMENT_STREAKS;
    while (!signal.aborted) {
      if (!(await delay(pollMs, signal))) {
        return STOPPED;
      }

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

      if (next.outcome) {
        return next.outcome;
      }
    }

    return STOPPED;
  }

  /**
   * The turn's entries, buffered prefix first and then the live edge, ending
   * on a terminal frame or when the reader walks away. `release` runs either
   * way: it is what gives the blocking Redis connection back.
   */
  async *streamTurnEntries({
    release,
    ...deps
  }: TailDeps & { release: () => void }): AsyncGenerator<LangyStreamEntry> {
    const { conversationId, turnId, buffer } = deps;
    try {
      // Drain the buffered prefix, then tail the live edge from where it ended.
      const { reads, lastId } = await buffer.readTail({ conversationId, turnId });
      for (const { entry } of reads) {
        yield entry;
        if (isTerminal(entry)) {
          return;
        }
      }

      yield* this.followLiveEdge({ ...deps, fromId: lastId });
    } finally {
      release();
    }
  }

  /**
   * The live edge from `fromId` on, ending when the turn ends, the reader goes away, or the
   * turn is given up for wedged. A refresh mid-turn can miss the worker's terminal frame (its
   * relay connection dropped before it).
   */
  private async *followLiveEdge({
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

    const watcher = this.watchForMissedTerminal({
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
        if (outcome.kind === "terminal") {
          synthesized = outcome.entry;
        }

        if (outcome.kind !== "stopped") {
          settle.abort();
        } // unblock the follow() below
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
        if (isTerminal(entry)) {
          return;
        }
      }
    } finally {
      settle.abort();
      await watcher; // already has its own .catch()
    }

    // follow() ended with no buffered terminal. If the watcher proved the turn
    // settled, deliver the synthesized terminal so the UI resolves instead of
    // hanging; the client reconciles the transcript via langy.messages.
    if (synthesized) {
      yield synthesized;
    }
  }

  /** Live entries of one turn: buffered prefix, then live edge until turn ends or reader leaves.
   * No deadline on turn itself (settlement watcher gives tail up when turn stops beating).
   * release() runs when tail ends for any reason, including reader mid-turn departure. */
}

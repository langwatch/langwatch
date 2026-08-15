/**
 * Await a turn's settlement — the shared primitive behind every "hold until
 * this turn finishes" surface (today: the public API's `Prefer: wait` mode).
 *
 * Two sources compose here, each doing the one job it is good at:
 *
 *  - The Redis token buffer (`LangyTokenBuffer.readTail`/`follow`) is the
 *    PROMPTNESS source: `follow` blocks on `XREAD BLOCK` keyed on
 *    `(conversationId, turnId)` and returns the moment the worker writes the
 *    terminal frame — no polling. It is best-effort (may be absent entirely
 *    when Redis is not configured) and its terminal frame carries no reply
 *    text, so it can only say "settled", never what settled to.
 *  - The durable fold (`getEventsAfter`) is the TRUTH source: `AGENT_RESPONDED`
 *    / `AGENT_RESPONSE_FAILED` carry the `turnId`, the outcome and the reply
 *    parts — what `finalizeTurn` calls "the real backend confirmation". It is
 *    the only thing this function ever returns from.
 *
 * So the loop polls the fold slowly while the buffer's follow() is armed, and
 * snaps to a fast confirm cadence the moment a terminal frame is seen —
 * buffer-first promptness, fold-only authority. Without Redis it degrades to a
 * plain fold poll at the fallback cadence.
 *
 * The signal is honored everywhere (the follow() block, the delays, the fold
 * loop), so an abandoned caller — client disconnect or deadline — stops
 * costing reads immediately.
 */

import type { LangyEventCursor } from "@langwatch/langy";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import { LangyConversationNotFoundError } from "~/server/app-layer/langy/errors";
import { extractTextFromParts } from "~/server/app-layer/langy/langy-message.service";
import { createLangyTokenBuffer } from "./langyTokenBuffer";

/**
 * Settled state of one turn, decided ONCE from the fold event that carries it.
 * `succeeded` is the discriminant consumers branch on; `outcome` is the event's
 * own enum (`AGENT_RESPONDED.data.outcome`, plus `"failed"` for
 * `AGENT_RESPONSE_FAILED`), preserved for the wire.
 */
export type TurnSettlement =
  | {
      succeeded: true;
      outcome: "completed" | "stopped";
      text: string;
      error: null;
    }
  | { succeeded: false; outcome: "failed"; text: null; error: string };

/** Fold poll cadence while follow() is armed — the buffer owns promptness. */
const BUFFERED_POLL_MS = 5_000;
/** Fold poll cadence with no Redis — polling is all we have. */
const FALLBACK_POLL_MS = 750;
/** Fold poll cadence after the buffer saw a terminal — projection catch-up. */
const CONFIRM_POLL_MS = 250;

/**
 * Sleep for `ms`, resolving early to `false` when the signal aborts — so a
 * waiter unblocks promptly on disconnect/deadline — otherwise `true`.
 */
export function abortableDelay(
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type ConversationTurnEvents = Awaited<
  ReturnType<
    ReturnType<typeof getApp>["langy"]["conversations"]["getEventsAfter"]
  >
>;

/**
 * The settlement decision, made at the only place with the evidence: the fold
 * events themselves. `AGENT_RESPONDED` with `outcome: "failed"` and
 * `AGENT_RESPONSE_FAILED` both collapse to the failed arm, so no consumer ever
 * re-derives "did it fail" from a string.
 */
export function settlementFromEvents(
  events: ConversationTurnEvents["events"],
  turnId: string,
): TurnSettlement | null {
  for (const event of events) {
    if (
      event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED &&
      event.data.turnId === turnId
    ) {
      if (event.data.outcome === "failed") {
        return {
          succeeded: false,
          outcome: "failed",
          text: null,
          error: event.data.error ?? "Turn failed",
        };
      }
      return {
        succeeded: true,
        outcome: event.data.outcome,
        text: extractTextFromParts(event.data.parts),
        error: null,
      };
    }
    if (
      event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED &&
      event.data.turnId === turnId
    ) {
      return {
        succeeded: false,
        outcome: "failed",
        text: null,
        error: event.data.error,
      };
    }
  }
  return null;
}

/**
 * One full pass over the fold from the zero cursor. Truncated pages are read
 * through within the pass (the cursor advances every page, so this terminates);
 * `LangyConversationNotFoundError` is projection lag — the accepted turn's row
 * has not landed yet — so it means "not settled yet", not "gone". Every other
 * error propagates.
 */
async function readSettlementFromFold({
  projectId,
  conversationId,
  turnId,
  userId,
  signal,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  signal: AbortSignal;
}): Promise<TurnSettlement | null> {
  let cursor: LangyEventCursor = { acceptedAt: 0, eventId: "" };
  while (!signal.aborted) {
    const events = await getApp()
      .langy.conversations.getEventsAfter({
        projectId,
        conversationId,
        userId,
        after: cursor,
      })
      .catch((error: unknown) => {
        if (error instanceof LangyConversationNotFoundError) return null;
        throw error;
      });
    if (!events) return null;
    const settlement = settlementFromEvents(events.events, turnId);
    if (settlement) return settlement;
    if (!events.truncated) return null;
    cursor = events.cursor;
  }
  return null;
}

/**
 * Hold until THIS turn settles on the fold, the signal aborts, or — nothing
 * else: there is no internal deadline. Callers own the deadline by composing it
 * into the signal (`AbortSignal.any([clientSignal, AbortSignal.timeout(...)])`).
 * Returns null when the signal aborted before settlement.
 *
 * `pollIntervalMs` overrides the no-Redis fallback cadence — a test seam, so
 * suites never sleep real wall-clock time.
 */
/**
 * A promise that never settles — used so an aborted/ended buffer follow can
 * never win the settlement race below.
 */
function neverSettles(): Promise<never> {
  return new Promise<never>(() => {
    // Intentionally never resolved.
  });
}

export async function awaitTurnSettlement({
  projectId,
  conversationId,
  turnId,
  userId,
  signal,
  pollIntervalMs = FALLBACK_POLL_MS,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  signal: AbortSignal;
  pollIntervalMs?: number;
}): Promise<TurnSettlement | null> {
  const redis = tryGetApp()?.redis ?? null;

  let terminalSeen: Promise<void> | null = null;
  let releaseBuffer = () => {
    // No buffered connection to release until one is opened below.
  };
  if (redis) {
    const blocking = (redis as { duplicate(): unknown }).duplicate();
    const buffer = createLangyTokenBuffer({ redis, blockingRedis: blocking });
    releaseBuffer = () => {
      (blocking as { disconnect(): void }).disconnect();
    };
    // Resolves when the buffer delivers a terminal frame (or never — abort and
    // buffer absence both leave it pending; the fold loop below is the
    // authority either way).
    terminalSeen = (async () => {
      const { reads, lastId } = await buffer.readTail({
        conversationId,
        turnId,
      });
      if (
        reads.some(
          ({ entry }) => entry.type === "end" || entry.type === "error",
        )
      ) {
        return;
      }
      for await (const { entry } of buffer.follow({
        conversationId,
        turnId,
        fromId: lastId,
        signal,
      })) {
        if (entry.type === "end" || entry.type === "error") return;
      }
      // follow() ended without a terminal: aborted. Stay pending forever so
      // the race below never mistakes an abort for a settlement signal.
      await neverSettles();
    })().catch(() => neverSettles());
  }

  let pollMs = terminalSeen !== null ? BUFFERED_POLL_MS : pollIntervalMs;
  try {
    while (!signal.aborted) {
      const settlement = await readSettlementFromFold({
        projectId,
        conversationId,
        turnId,
        userId,
        signal,
      });
      if (settlement) return settlement;

      if (terminalSeen !== null) {
        const raced = await Promise.race([
          terminalSeen.then(() => "terminal" as const),
          abortableDelay(pollMs, signal).then((completed) =>
            completed ? ("tick" as const) : ("abort" as const),
          ),
        ]);
        if (raced === "abort") return null;
        if (raced === "terminal") {
          // The turn IS settled; only the projection may lag. Confirm fast.
          terminalSeen = null;
          pollMs = CONFIRM_POLL_MS;
        }
      } else if (!(await abortableDelay(pollMs, signal))) {
        return null;
      }
    }
    return null;
  } finally {
    releaseBuffer();
  }
}

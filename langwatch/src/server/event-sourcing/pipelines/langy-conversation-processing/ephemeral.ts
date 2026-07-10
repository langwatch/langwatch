import { z } from "zod";
import { LANGY_EPHEMERAL_SIGNAL_TYPES } from "./schemas/constants";

/**
 * Ephemeral signals for a Langy conversation (ADR-046).
 *
 * These are the OPPOSITE of durable events. A `status` or `progress` signal is
 * pure live transport: it tells the UI "the agent is searching traces…" / "42%
 * done" while a turn runs. It carries no state the conversation needs after the
 * turn ends. So it is NEVER written to `event_log`, the fold, or the map
 * projection — persisting one per tick (or, in PR3, per streamed token) would
 * flood the log and leave a residue no consumer wants.
 *
 * ## Lifecycle (fully in PR3; this file is the PR2 seam/contract)
 *
 * 1. **Produce** — the streaming worker calls `publish(tenantId, signal)`
 *    during a turn (this replaces the `ReportStatus` / `ReportProgress`
 *    commands the durable pipeline used to carry).
 * 2. **Transport** — the publisher writes the signal to a short-lived,
 *    per-conversation Redis structure (a capped list / pub-sub keyed by
 *    `langy:ephemeral:{tenantId}:{conversationId}`) with a TTL. NOT `event_log`.
 * 3. **Consume** — the live `/chat` stream (or a subscription) tails that
 *    buffer for the active conversation and renders the signals inline.
 * 4. **Drop** — when the turn ends, or the TTL lapses, the signals are gone.
 *    On history reload only DURABLE messages appear; ephemeral signals never do.
 *
 * ## Liveness / orphan detection (PR3)
 *
 * The durable fold says a turn is in flight (`CurrentTurnId` set by
 * `agent_turn_started`, cleared by `turn_finalized`). The RECENCY of ephemeral
 * heartbeats in Redis says whether the worker is still alive. "CurrentTurnId
 * set but no ephemeral signal for N seconds" → orphaned turn → dispatch the
 * durable `ReconcileAgentTurn`. Liveness therefore lives entirely off the fold.
 *
 * PR2 ships only this contract + a no-op default; PR3 implements the Redis
 * transport and wires the worker + the live consumer.
 */

export const langyStatusSignalSchema = z.object({
  type: z.literal(LANGY_EPHEMERAL_SIGNAL_TYPES.STATUS_REPORTED),
  conversationId: z.string(),
  turnId: z.string().optional(),
  status: z.string(),
  occurredAt: z.number(),
});
export type LangyStatusSignal = z.infer<typeof langyStatusSignalSchema>;

export const langyProgressSignalSchema = z.object({
  type: z.literal(LANGY_EPHEMERAL_SIGNAL_TYPES.PROGRESS_REPORTED),
  conversationId: z.string(),
  turnId: z.string().optional(),
  message: z.string().optional(),
  progress: z.number().optional(),
  occurredAt: z.number(),
});
export type LangyProgressSignal = z.infer<typeof langyProgressSignalSchema>;

export const langyEphemeralSignalSchema = z.discriminatedUnion("type", [
  langyStatusSignalSchema,
  langyProgressSignalSchema,
]);
export type LangyEphemeralSignal = z.infer<typeof langyEphemeralSignalSchema>;

/**
 * Publishes an ephemeral signal to the live transport (Redis buffer in PR3).
 * The contract PR3 implements; PR2 wires the no-op below.
 */
export interface LangyEphemeralPublisher {
  publish(tenantId: string, signal: LangyEphemeralSignal): Promise<void>;
}

/**
 * PR2 default — drops signals. There is no live transport yet and no worker
 * producing signals, so dropping is correct (not silent data loss): ephemeral
 * signals are non-durable by definition.
 */
export class NoopLangyEphemeralPublisher implements LangyEphemeralPublisher {
  async publish(): Promise<void> {
    /* no-op until PR3 wires the Redis transport */
  }
}

/**
 * Per-turn spawn handoff (ADR-044).
 *
 * The durable `agent_turn_accepted` event carries only `{ conversationId,
 * turnId }` — it must never carry secrets or duplicate the prompt into the
 * immutable event log. But the worker's spawn function needs the non-durable
 * spawn inputs: the session-scoped credentials (minted by the route, ADR-047),
 * the prompt, the system block, and the model override.
 *
 * Those ride a short-lived Redis handoff keyed by turnId (same hash-tag slot as
 * the token stream, ADR-006). The service stashes them before dispatching
 * `AcceptAgentTurn`; the process-outbox effect reads them when it dispatches the
 * worker. Reads are non-destructive so outbox and liveness retries can reuse the
 * same input until TTL expiry. The liveness subscriber terminalizes an abandoned
 * turn.
 */

import type { LangyCredentials } from "../LangyCredentialService";

/** The non-durable inputs the spawn function needs, out of band from the event. */
export interface LangyTurnHandoff {
  projectId: string;
  conversationId: string;
  turnId: string;
  actorUserId: string;
  prompt: string;
  system: string;
  /**
   * The conversation-so-far seed (transcript + resource memory) the worker
   * manager folds into the FIRST message of a fresh session. Carried on every
   * stash so an outbox or liveness re-drive that lands on a fresh worker still
   * continues the conversation; a warm session ignores it (its own transcript
   * already carries the seed from its first post). Absent for a brand-new
   * conversation.
   */
  historySeed?: string;
  modelOverride?: string;
  credentials: LangyCredentials;
  /**
   * The per-conversation runToken (LANGY_WORKER_REDESIGN_PLAN §0a) the manager
   * signs its relay frames with. Carried HERE rather than relying on operational
   * state, because a brand-new conversation's creation event may still be queued
   * when its first dispatch intent runs. The service mints it (new) or reads it
   * (continue) and stashes it before command dispatch. Empty only for a legacy
   * conversation with no runToken (the
   * dispatch then runs with no live edge; the durable final still lands).
   */
  runToken: string;
  /**
   * Whether the route reserved a GitHub-PR permit for this turn. The worker
   * reconciles/releases it on completion (ADR-044): release-only-if-reserved
   * preserves the erosion-via-blip cap-bypass fix from the old synchronous
   * route (a Redis-down reserve returns `reserved: false`).
   */
  permitReserved: boolean;
  /**
   * ADR-048 shutdown-handoff: an opaque, worker-authored resume token from a
   * prior turn that checkpointed on pod termination. Set by the route when it
   * found a pending handoff on the conversation projection; `runTurn` threads it onto
   * the manager /chat body so opencode resumes from the checkpoint instead of a
   * cold start. Absent on a normal turn.
   */
  resumeToken?: string;
}

/** Minimal Redis surface. Injected so unit tests need no live server. */
export interface LangyHandoffRedis {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/** TTL for a stashed handoff. Matches the stream buffer window (ADR-044). */
export const LANGY_HANDOFF_TTL_SECONDS = 300;

function handoffKey(conversationId: string, turnId: string): string {
  return `langy:handoff:{${conversationId}}:${turnId}`;
}

export class LangyTurnHandoffStore {
  constructor(private readonly redis: LangyHandoffRedis) {}

  async stash(handoff: LangyTurnHandoff): Promise<void> {
    await this.redis.set(
      handoffKey(handoff.conversationId, handoff.turnId),
      JSON.stringify(handoff),
      "EX",
      LANGY_HANDOFF_TTL_SECONDS,
    );
  }

  /**
   * Read without consuming. The process outbox and liveness subscriber must both
   * be able to reuse the same inputs on retry. It ages out on its own TTL; replay
   * invokes neither live delivery path. Returns null when it never existed or
   * aged out.
   */
  async read({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnHandoff | null> {
    const raw = await this.redis.get(handoffKey(conversationId, turnId));
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as LangyTurnHandoff;
    } catch {
      return null;
    }
  }
}

export function createLangyTurnHandoffStore(deps: {
  redis: unknown;
}): LangyTurnHandoffStore {
  return new LangyTurnHandoffStore(deps.redis as LangyHandoffRedis);
}

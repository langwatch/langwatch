/**
 * Per-turn spawn handoff (ADR-044).
 *
 * The durable `agent_turn_started` event carries only `{ conversationId,
 * turnId }` — it must never carry secrets or duplicate the prompt into the
 * immutable event log. But the worker's spawn function needs the non-durable
 * spawn inputs: the session-scoped credentials (minted by the route, ADR-047),
 * the prompt, the system block, and the model override.
 *
 * Those ride a short-lived Redis handoff keyed by turnId (same hash-tag slot as
 * the token stream, ADR-006). The route stashes them just before dispatching
 * `StartAgentTurn`; the spawn reactor takes-and-deletes them on the worker. TTL
 * matches the stream buffer — a handoff that ages out means the reconcile sweep
 * terminalizes the turn (the credentials are single-use per-turn anyway).
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
  modelOverride?: string;
  credentials: LangyCredentials;
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
   * found a pending handoff on the conversation fold; `runTurn` threads it onto
   * the manager /chat body so opencode resumes from the checkpoint instead of a
   * cold start. Absent on a normal turn.
   */
  resumeToken?: string;
}

/** Minimal Redis surface. Injected so unit tests need no live server. */
export interface LangyHandoffRedis {
  set(
    key: string,
    value: string,
    mode: "EX",
    ttl: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
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
   * Read and delete the handoff — single-use. Returns null when it never
   * existed or already aged out (the reconcile sweep handles that turn).
   */
  async take({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnHandoff | null> {
    const key = handoffKey(conversationId, turnId);
    const raw = await this.redis.get(key);
    if (raw == null) return null;
    await this.redis.del(key);
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

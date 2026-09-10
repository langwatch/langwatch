import { z } from "zod";
/**
 * The records one live turn leaves outside Postgres: who may watch it, what a
 * worker needs to pick it up, the frame nonces already seen, and the links a
 * navigate command resolves. Every one is keyed by conversation and turn and
 * expires on its own; Redis holds them in a deployment that has one.
 */

/** Synchronous actor authorization record for Langy's live turn stream. */
export const LANGY_TURN_ACCESS_TTL_SECONDS = 300;

export const langyTurnAccessSchema = z
  .object({
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();
export type LangyTurnAccess = z.infer<typeof langyTurnAccessSchema>;

/**
 * Who is allowed to watch a turn stream, for the window the turn is live. A seam because the
 * answer has to survive one process asking about a turn another process started, which is what
 * makes it stored rather than derived.
 */
export abstract class LangyTurnAccessRepository {
  /** Records the actor this turn belongs to. */
  abstract grant(access: LangyTurnAccess): Promise<void>;

  /** Whether the recorded actor is this one. Unknown turns answer false. */
  abstract isTurnActor(access: LangyTurnAccess): Promise<boolean>;
}

import { langyWorkerCredentialsSchema } from "@langwatch/langy-contract";

export const langyTurnHandoffSchema = z
  .object({
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    actorUserId: z.string().min(1),
    prompt: z.string(),
    system: z.string(),
    historySeed: z.string().optional(),
    modelOverride: z.string().optional(),
    credentials: langyWorkerCredentialsSchema,
    runToken: z.string().min(1),
    permitReserved: z.boolean(),
    resumeToken: z.string().optional(),
  })
  .strict();
export type LangyTurnHandoff = z.infer<typeof langyTurnHandoffSchema>;

export const LANGY_HANDOFF_TTL_SECONDS = 300;

/**
 * Everything a worker needs to pick a turn up, parked for the window between
 * the process that admitted the turn and the process that runs it.
 */
export abstract class LangyTurnHandoffRepository {
  /** Parks the handoff for its TTL. */
  abstract stash(handoff: LangyTurnHandoff): Promise<void>;

  /** The parked handoff, or nothing when it never landed or has lapsed. */
  abstract read(input: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnHandoff | null>;

  /** Extends a live handoff's TTL. False when there was nothing to extend. */
  abstract refresh(input: { conversationId: string; turnId: string }): Promise<boolean>;

  /**
   * Records that this turn was stopped, so a re-driven outbox handoff is not
   * dispatched again. Same TTL as the handoff it guards.
   */
  abstract markStopped(input: { conversationId: string; turnId: string }): Promise<void>;

  /** Whether a stop was recorded for this turn (see `markStopped`). */
  abstract isStopped(input: { conversationId: string; turnId: string }): Promise<boolean>;
}

/** Cross-instance frame nonce deduplication for Langy relay frames. */
export interface LangyFrameDedupRepository {
  reserveFrameNonce(input: {
    conversationId: string;
    turnId: string;
    frameNonce: string;
  }): Promise<boolean>;
}

/** Conversation-scoped links Langy's navigate command resolves an id against. */
export interface LangyResourceLinksRepository {
  remember(input: {
    conversationId: string;
    links: Array<{ id: string; href: string }>;
  }): Promise<void>;
  resolve(input: { conversationId: string; id: string }): Promise<string | null>;
}

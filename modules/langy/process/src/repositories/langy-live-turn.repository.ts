import { z } from "zod";
/**
 * The records one live turn leaves outside Postgres: who may watch it,
 * what a worker needs to pick it up, seen frame nonces, and navigate
 * links. Keyed by conversation and turn, expiring on its own via Redis.
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

  /** The parked handoff; `miss` when it never landed, has lapsed or no longer parses. */
  abstract read(input: { conversationId: string; turnId: string }): Promise<LangyTurnHandoffLookup>;

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

/** A remembered link, or a miss the caller answers from the platform's own lookup. */
export type LangyTurnHandoffLookup = { kind: "hit"; handoff: LangyTurnHandoff } | { kind: "miss" };

export type LangyResourceLinkLookup = { kind: "hit"; href: string } | { kind: "miss" };

/** Conversation-scoped links Langy's navigate command resolves an id against. */
export interface LangyResourceLinksRepository {
  remember(input: { conversationId: string; links: { id: string; href: string }[] }): Promise<void>;
  resolve(input: { conversationId: string; id: string }): Promise<LangyResourceLinkLookup>;
}

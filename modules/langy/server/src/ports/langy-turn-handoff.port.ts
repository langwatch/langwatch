import { langyWorkerCredentialsSchema } from "@langwatch/langy-contract";
import { z } from "zod";

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
export abstract class LangyTurnHandoffPort {
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

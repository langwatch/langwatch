import { z } from "zod";

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
 * Who is allowed to watch a turn stream, for the window the turn is live.
 *
 * A seam because the answer has to survive one process asking about a turn
 * another process started, which is what makes it stored rather than derived.
 */
export abstract class LangyTurnAccessPort {
  /** Records the actor this turn belongs to. */
  abstract grant(access: LangyTurnAccess): Promise<void>;

  /** Whether the recorded actor is this one. Unknown turns answer false. */
  abstract isTurnActor(access: LangyTurnAccess): Promise<boolean>;
}

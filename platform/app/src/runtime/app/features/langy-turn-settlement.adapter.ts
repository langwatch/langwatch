import type { LangyService } from "@langwatch/langy-contract";
import { awaitTurnSettlement, type TurnSettlement } from "@langwatch/langy-server";

export type { TurnSettlement } from "@langwatch/langy-server";

/** Process adapter for the Redis-assisted wait path used by the public HTTP transport. */
export function awaitLangyTurnSettlement(input: {
  langy: LangyService;
  redis: { duplicate(): { disconnect(): void } } | null;
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  signal: AbortSignal;
}): Promise<TurnSettlement | null> {
  return awaitTurnSettlement(input);
}

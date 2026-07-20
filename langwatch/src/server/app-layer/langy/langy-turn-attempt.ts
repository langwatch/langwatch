import { createLogger } from "@langwatch/observability";

import type { LangyTurnServiceDeps } from "./langy-turn.service";

const logger = createLogger("langwatch:langy:turn-attempt");

export interface LangyTurnAttemptIdentity {
  projectId: string;
  userId: string;
  requestId: string;
  conversationId: string;
  turnId: string;
  claimToken: string;
}

/** Owns every compensating action until the durable turn acceptance commits. */
export class LangyTurnAttempt {
  private permitReserved = false;
  private mintedApiKeyId: string | null = null;
  private turnCommitted = false;

  constructor(
    private readonly identity: LangyTurnAttemptIdentity,
    private readonly deps: Pick<
      LangyTurnServiceDeps,
      "admission" | "releasePermit" | "revokeSessionKey"
    >,
  ) {}

  retainPermit(reserved: boolean): void {
    this.permitReserved = reserved;
  }

  retainSessionKey(apiKeyId: string): void {
    this.mintedApiKeyId = apiKeyId;
  }

  /** From this point the worker/terminal-event lifecycle owns all resources. */
  async commit(): Promise<boolean> {
    this.turnCommitted = true;
    try {
      await this.deps.admission.commit({ ...this.identity });
      return true;
    } catch (error) {
      // The canonical acceptance event is already durable. Returning an error
      // would invite a retry even though the turn may run via the outbox.
      logger.error(
        { error, turnId: this.identity.turnId },
        "failed to mark langy turn admission committed",
      );
      return false;
    }
  }

  async abort(): Promise<void> {
    if (this.turnCommitted) return;
    const cleanups: Promise<unknown>[] = [
      this.deps.admission.abort({ ...this.identity }),
    ];
    if (this.permitReserved) {
      cleanups.push(this.deps.releasePermit({ userId: this.identity.userId }));
    }
    if (this.mintedApiKeyId) {
      cleanups.push(
        this.deps.revokeSessionKey({
          apiKeyId: this.mintedApiKeyId,
          projectId: this.identity.projectId,
        }),
      );
    }
    const results = await Promise.allSettled(cleanups);
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(
          { error: result.reason, turnId: this.identity.turnId },
          "failed to compensate aborted langy turn preparation",
        );
      }
    }
  }
}

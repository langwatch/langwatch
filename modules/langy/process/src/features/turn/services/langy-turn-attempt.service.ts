import { createLogger } from "@langwatch/observability";

import type { LangyTurnServiceDeps } from "./langy-turn-shared.service.ts";

const logger = createLogger("langwatch:langy:turn-attempt");

interface LangyTurnAttemptIdentity {
  projectId: string;
  userId: string;
  idempotencyKey: string;
  conversationId: string;
  turnId: string;
  claimToken: string;
}

/** Owns every compensating action until the durable turn acceptance commits. */
export class LangyTurnAttemptService {
  private permitReserved = false;
  private mintedApiKeyId: string | null = null;
  private heldKey: string | undefined;
  private turnCommitted = false;

  private constructor(
    private readonly identity: LangyTurnAttemptIdentity,
    private readonly deps: LangyTurnServiceDeps,
  ) {}

  static create(
    identity: LangyTurnAttemptIdentity,
    deps: LangyTurnServiceDeps,
  ): LangyTurnAttemptService {
    return new LangyTurnAttemptService(identity, deps);
  }

  retainPermit(reserved: boolean): void {
    this.permitReserved = reserved;
  }

  /** `holdKey` when the key was held, so its revoke also drops the held entry. */
  retainSessionKey(apiKeyId: string, holdKey?: string): void {
    this.mintedApiKeyId = apiKeyId;
    this.heldKey = holdKey;
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
    if (this.turnCommitted) {
      return;
    }

    const cleanups: Promise<unknown>[] = [this.deps.admission.abort({ ...this.identity })];
    if (this.permitReserved) {
      cleanups.push(this.deps.permits.release({ userId: this.identity.userId }));
    }

    if (this.mintedApiKeyId) {
      cleanups.push(
        this.deps.sessionKeys.revoke({
          apiKeyId: this.mintedApiKeyId,
          projectId: this.identity.projectId,
          ...(this.heldKey ? { holdKey: this.heldKey } : {}),
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

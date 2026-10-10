import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:ops:system-migrations:kick");

/** The kick command's sender, as ops' own pipeline answers with it once registered. */
export type SystemMigrationPassRequestSender = {
  send(input: { tenantId: string; occurredAt: number }): Promise<unknown>;
};

/**
 * Binds the "run a pass now" command after ops' pipeline registers, so the kick continues through
 * the owning pipeline. Fire-and-forget as on main: a kick that cannot be sent is logged, never
 * refused; the hourly re-drive still reaches any tenant that could move.
 */
export class SystemMigrationPassRequestsService {
  static create(): SystemMigrationPassRequestsService {
    return new SystemMigrationPassRequestsService();
  }

  private constructor() {}

  #sender: SystemMigrationPassRequestSender | null = null;

  connect(sender: SystemMigrationPassRequestSender): void {
    this.#sender = sender;
  }

  async request({ actorUserId }: { actorUserId: string }): Promise<void> {
    if (!this.#sender) {
      logger.warn(
        { actorUserId },
        "system migration pass not requested: this process never connected the pass command",
      );
      return;
    }
    try {
      await this.#sender.send({
        tenantId: actorUserId,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.error({ error, actorUserId }, "system migration pass request failed to send");
    }
  }
}

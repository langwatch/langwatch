import { OpsCapabilityUnavailableError } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

/** The kick command's sender, as ops' own pipeline answers with it once registered. */
export type SystemMigrationPassRequestSender = {
  send(input: { tenantId: string; occurredAt: number }): Promise<unknown>;
};

/**
 * Binds the "run a pass now" command after ops' pipeline registers, so the kick continues through
 * the owning pipeline. Refuses by name in a process that never connected it.
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
      throw new OpsCapabilityUnavailableError("the system migration pass command");
    }
    await this.#sender.send({ tenantId: actorUserId, occurredAt: nowInstant().epochMilliseconds });
  }
}

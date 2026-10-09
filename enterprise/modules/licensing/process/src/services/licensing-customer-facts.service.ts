import type { EventingCommands } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { LicensingCustomerPipeline } from "../eventing/licensing-customer.pipeline.ts";

/** Records licensing's facts about its customers on its own pipeline (R42). */
export class LicensingCustomerFactsService {
  #commands: EventingCommands<LicensingCustomerPipeline> | undefined;

  static create(): LicensingCustomerFactsService {
    return new LicensingCustomerFactsService();
  }

  private constructor() {}

  /** Binds the licensing_customer pipeline's own senders. */
  connect(commands: EventingCommands<LicensingCustomerPipeline>): void {
    this.#commands = commands;
  }

  /** Organization creates and marks the customer's row under this id, seconds later. */
  async selfHostedCustomerLicensed({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<void> {
    if (!this.#commands) {
      throw new Error("licensing_customer pipeline senders are not connected yet");
    }
    await this.#commands.recordSelfHostedCustomerLicensed.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      name,
    });
  }
}

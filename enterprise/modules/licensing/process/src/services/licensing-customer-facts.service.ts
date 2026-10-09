import type { EventingCommands } from "@langwatch/eventing";
import { type Instant, nowInstant } from "@langwatch/time";

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
    await this.commands().recordSelfHostedCustomerLicensed.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      name,
    });
  }

  /** Organization keeps the refusal list on its own row from this fact, seconds later. */
  async connectServiceSwitched({
    organizationId,
    service,
    enabled,
  }: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<void> {
    await this.commands().recordConnectServiceSwitched.send({
      tenantId: organizationId,
      occurredAt: nowInstant().epochMilliseconds,
      organizationId,
      service,
      enabled,
    });
  }

  /** Organization writes when the sync landed, or the code it failed on, from this fact. */
  async licenseSyncFinished({
    organizationId,
    at,
    error,
  }: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void> {
    await this.commands().recordLicenseSyncFinished.send({
      tenantId: organizationId,
      occurredAt: at.epochMilliseconds,
      organizationId,
      error,
    });
  }

  private commands(): EventingCommands<LicensingCustomerPipeline> {
    if (!this.#commands) {
      throw new Error("licensing_customer pipeline senders are not connected yet");
    }
    return this.#commands;
  }
}

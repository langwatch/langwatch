import { createLogger } from "@langwatch/observability";

import {
  type EmailContent,
  EmailDelivery,
  type EmailGateway,
  type EmailGatewayOpener,
  type MailerConfiguration,
} from "../channels/email-delivery.channel.ts";
import { EmailProviderService } from "./email-provider.service.ts";

const logger = createLogger("langwatch:mailer:runtime");

/**
 * Per-executable mail delivery; gateway resolved on first send (not construction)
 * to allow deployments without email provider. Send failures must be survived.
 */
export class EmailDeliveryService extends EmailDelivery {
  static create(input: {
    configuration: MailerConfiguration;
    openGateway: EmailGatewayOpener;
  }): EmailDeliveryService {
    return new EmailDeliveryService(input.configuration, input.openGateway);
  }

  private gateway: EmailGateway | undefined;

  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly configuration: MailerConfiguration,
    private readonly openGateway: EmailGatewayOpener,
  ) {
    super();
  }

  override defaultFrom(): string {
    return this.configuration.defaultFrom;
  }

  override async send(content: EmailContent): Promise<unknown> {
    this.ensureOpen();
    const gateway = this.resolveGateway();
    if (!gateway) {
      logger.error("No email sending method available. Skipping email sending.");
      throw new Error("No email sending method available. Skipping email sending.");
    }
    return gateway.send({ content, defaultFrom: this.configuration.defaultFrom });
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private resolveGateway(): EmailGateway | undefined {
    if (this.gateway) return this.gateway;

    const providerName = EmailProviderService.create(this.configuration).pickProviderName();
    if (!providerName) return undefined;

    this.gateway = this.openGateway(providerName);
    return this.gateway;
  }

  private async closeOnce(): Promise<void> {
    const gateway = this.gateway;
    this.gateway = undefined;
    try {
      await gateway?.close();
    } catch (error) {
      logger.error({ error, provider: gateway?.name }, "Failed to close email provider");
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closePromise !== undefined) {
      throw new Error("Mailer runtime is closed.");
    }
  }
}

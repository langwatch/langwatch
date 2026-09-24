import { createLogger } from "@langwatch/observability";

import {
  type EmailContent,
  EmailDelivery,
  type EmailGateway,
  type EmailOutboundProxyConfig,
  type EmailProviderName,
  type MailerConfiguration,
} from "../channels/email-delivery.channel.ts";
import { EmailProviderService } from "./email-provider.service.ts";
import { ResendEmailGatewayAdapter } from "./resend.email-gateway.service.ts";
import { SendgridEmailGatewayAdapter } from "./sendgrid.email-gateway.service.ts";
import {
  SesEmailGatewayAdapter,
  type SesAwsClientConfiguration,
} from "./ses.email-gateway.service.ts";
import { SmtpEmailGatewayAdapter } from "./smtp.email-gateway.service.ts";

const logger = createLogger("langwatch:mailer:runtime");

/**
 * Per-executable mail delivery; gateway resolved on first send (not construction)
 * to allow deployments without email provider. Send failures must be survived.
 */
export class EmailDeliveryAdapter extends EmailDelivery {
  static create(input: {
    configuration: MailerConfiguration;
    aws: SesAwsClientConfiguration;
    outboundProxy: EmailOutboundProxyConfig;
  }): EmailDeliveryAdapter {
    return new EmailDeliveryAdapter(input.configuration, input.aws, input.outboundProxy);
  }

  private gateway: EmailGateway | undefined;

  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly configuration: MailerConfiguration,
    private readonly aws: SesAwsClientConfiguration,
    private readonly outboundProxy: EmailOutboundProxyConfig,
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

    this.gateway = this.createGateway(providerName);
    return this.gateway;
  }

  private createGateway(name: EmailProviderName): EmailGateway {
    switch (name) {
      case "ses":
        return SesEmailGatewayAdapter.create({
          configuration: this.configuration.ses,
          aws: this.aws,
        });
      case "sendgrid":
        return SendgridEmailGatewayAdapter.create(this.configuration.sendgrid);
      case "smtp":
        return SmtpEmailGatewayAdapter.create(this.configuration.smtp);
      case "resend":
        return ResendEmailGatewayAdapter.create({
          configuration: this.configuration.resend,
          outboundProxy: this.outboundProxy,
        });
    }
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

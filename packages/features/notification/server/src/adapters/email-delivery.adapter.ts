import { createLogger } from "@langwatch/observability";
import {
  type EmailContent,
  EmailDeliveryPort,
  type EmailGatewayPort,
  type EmailOutboundProxyConfig,
  type EmailProviderName,
  type MailerConfiguration,
} from "../ports/email-delivery.port";
import { EmailProviderService } from "../services/email-provider.service";
import { ResendEmailGatewayAdapter } from "./resend.email-gateway.adapter";
import { SendgridEmailGatewayAdapter } from "./sendgrid.email-gateway.adapter";
import {
  SesEmailGatewayAdapter,
  type SesAwsClientConfiguration,
} from "./ses.email-gateway.adapter";
import { SmtpEmailGatewayAdapter } from "./smtp.email-gateway.adapter";

const logger = createLogger("langwatch:mailer:runtime");

/**
 * One mail delivery graph per executable. Provider choice and credentials are
 * immutable after boot; transport pools are retained until orderly shutdown.
 *
 * The gateway is resolved on the FIRST send rather than at construction, which
 * is what makes a deployment with no email provider an ordinary self-hosted
 * install rather than a process that will not start. What such a deployment
 * gets is a throwing send its caller is expected to survive — the notification
 * fan-outs treat a failed send as a missing courtesy, never as a lost fact.
 */
export class EmailDeliveryAdapter extends EmailDeliveryPort {
  static create(input: {
    configuration: MailerConfiguration;
    aws: SesAwsClientConfiguration;
    outboundProxy: EmailOutboundProxyConfig;
  }): EmailDeliveryAdapter {
    return new EmailDeliveryAdapter(input.configuration, input.aws, input.outboundProxy);
  }

  private gateway: EmailGatewayPort | undefined;

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
    return await gateway.send({ content, defaultFrom: this.configuration.defaultFrom });
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private resolveGateway(): EmailGatewayPort | undefined {
    if (this.gateway) return this.gateway;

    const providerName = EmailProviderService.create(this.configuration).tryResolveName();
    if (!providerName) return undefined;

    this.gateway = this.createGateway(providerName);
    return this.gateway;
  }

  private createGateway(name: EmailProviderName): EmailGatewayPort {
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

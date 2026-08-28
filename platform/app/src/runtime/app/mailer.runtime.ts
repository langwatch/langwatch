import { createLogger } from "@langwatch/observability";
import type { AppAwsClientConfiguration } from "./aws-client.composition";
import { ResendEmailProvider } from "~/server/mailer/providers/resend";
import { SendgridEmailProvider } from "~/server/mailer/providers/sendgrid";
import { SesEmailProvider } from "~/server/mailer/providers/ses";
import { SmtpEmailProvider } from "~/server/mailer/providers/smtp";
import { resolveEmailProviderName } from "~/server/mailer/providers";
import type {
  EmailContent,
  EmailProviderName,
  EmailProviderPort,
  MailerConfiguration,
} from "~/server/mailer/providers/types";
import { EmailDeliveryPort } from "~/server/mailer/providers/types";
import type { OutboundProxyConfig } from "~/server/outboundProxy";

const logger = createLogger("langwatch:mailer:runtime");

/**
 * One mail delivery graph per executable. Provider choice and credentials are
 * immutable after boot; transport pools are retained until orderly shutdown.
 */
export class AppMailerRuntime extends EmailDeliveryPort {
  static create(input: {
    configuration: MailerConfiguration;
    aws: AppAwsClientConfiguration;
    outboundProxy: OutboundProxyConfig;
  }): AppMailerRuntime {
    return new AppMailerRuntime(input.configuration, input.aws, input.outboundProxy);
  }

  private provider: EmailProviderPort | undefined;

  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly configuration: MailerConfiguration,
    private readonly aws: AppAwsClientConfiguration,
    private readonly outboundProxy: OutboundProxyConfig,
  ) {
    super();
  }

  override defaultFrom(): string {
    return this.configuration.defaultFrom;
  }

  override async send(content: EmailContent): Promise<unknown> {
    this.ensureOpen();
    const provider = this.resolveProvider();
    if (!provider) {
      logger.error("No email sending method available. Skipping email sending.");
      throw new Error("No email sending method available. Skipping email sending.");
    }
    return await provider.send({ content, defaultFrom: this.configuration.defaultFrom });
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private resolveProvider(): EmailProviderPort | undefined {
    if (this.provider) return this.provider;

    const providerName = resolveEmailProviderName(this.configuration);
    if (!providerName) return undefined;

    this.provider = this.createProvider(providerName);
    return this.provider;
  }

  private createProvider(name: EmailProviderName): EmailProviderPort {
    switch (name) {
      case "ses":
        return SesEmailProvider.create({ configuration: this.configuration.ses, aws: this.aws });
      case "sendgrid":
        return SendgridEmailProvider.create(this.configuration.sendgrid);
      case "smtp":
        return SmtpEmailProvider.create(this.configuration.smtp);
      case "resend":
        return ResendEmailProvider.create({
          configuration: this.configuration.resend,
          outboundProxy: this.outboundProxy,
        });
    }
  }

  private async closeOnce(): Promise<void> {
    const provider = this.provider;
    this.provider = undefined;
    try {
      await provider?.close?.();
    } catch (error) {
      logger.error({ error, provider: provider?.name }, "Failed to close email provider");
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closePromise !== undefined) {
      throw new Error("Mailer runtime is closed.");
    }
  }
}

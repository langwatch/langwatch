import { createLogger } from "@langwatch/observability";
import { ResendEmailProvider } from "../providers/resend";
import { SendgridEmailProvider } from "../providers/sendgrid";
import { SesEmailProvider, type SesAwsClientConfiguration } from "../providers/ses";
import { SmtpEmailProvider } from "../providers/smtp";
import { resolveEmailProviderName } from "../providers";
import type {
  EmailContent,
  EmailProviderName,
  EmailProviderPort,
  MailerConfiguration,
} from "../providers/types";
import { EmailDeliveryPort } from "../providers/types";
import type { OutboundProxyConfig } from "@langwatch/egress";

const logger = createLogger("langwatch:mailer:runtime");

/**
 * One mail delivery graph per executable. Provider choice and credentials are
 * immutable after boot; transport pools are retained until orderly shutdown.
 */
export class MailerAdapter extends EmailDeliveryPort {
  static create(input: {
    configuration: MailerConfiguration;
    aws: SesAwsClientConfiguration;
    outboundProxy: OutboundProxyConfig;
  }): MailerAdapter {
    return new MailerAdapter(input.configuration, input.aws, input.outboundProxy);
  }

  private provider: EmailProviderPort | undefined;

  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly configuration: MailerConfiguration,
    private readonly aws: SesAwsClientConfiguration,
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
      throw new Error("Mailer is closed.");
    }
  }
}

import {
  SESClient,
  type SESClientConfig,
  SendEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import { createLogger } from "@langwatch/observability";
import {
  type EmailContent,
  EmailGatewayPort,
  type MailerConfiguration,
} from "../ports/email-delivery.port";
import { EmailMimeService } from "../services/email-mime.service";

const logger = createLogger("langwatch:mailer:ses");

/**
 * The process-owned AWS transport, as this gateway needs to see it.
 *
 * Not a `*Port` abstract class on purpose: what a composition root already
 * holds is `AwsClientProcessRuntime`, whose `build` returns exactly this, so
 * demanding a subclass here would make every root wrap the object it has.
 */
export interface SesAwsClientConfiguration {
  build(input: { region?: string; targetHost: string; endpoint?: string }): SESClientConfig;
}

/** Public regional SES endpoint, used to decide proxy applicability. */
const defaultSesHost = (region: string) =>
  `email.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;

/** One lazy SES client per mailer process. Its borrowed handler is released by AWS shutdown. */
export class SesEmailGatewayAdapter extends EmailGatewayPort {
  static create(input: {
    configuration: MailerConfiguration["ses"];
    aws: SesAwsClientConfiguration;
  }): SesEmailGatewayAdapter {
    return new SesEmailGatewayAdapter(input.configuration, input.aws);
  }

  static buildClientConfig({
    configuration,
    aws,
  }: {
    configuration: MailerConfiguration["ses"];
    aws: SesAwsClientConfiguration;
  }): SESClientConfig {
    const { region, endpoint } = configuration;

    // Credentials come from the default chain: SES has always run on the
    // deployment's own identity. The SDK's retries stay on, because an alert
    // send has no ladder above it to take them over.
    return aws.build({
      region,
      targetHost: endpoint ?? defaultSesHost(region ?? ""),
      endpoint,
    });
  }

  readonly name = "ses" as const;

  private readonly mime = EmailMimeService.create();

  private client: SESClient | undefined;

  private closed = false;

  private constructor(
    private readonly configuration: MailerConfiguration["ses"],
    private readonly aws: SesAwsClientConfiguration,
  ) {
    super();
  }

  async send({ content, defaultFrom }: { content: EmailContent; defaultFrom: string }) {
    if (this.closed) throw new Error("SES email provider is closed.");
    logger.info("Sending email using AWS SES");
    const sesClient = (this.client ??= new SESClient(
      SesEmailGatewayAdapter.buildClientConfig({
        configuration: this.configuration,
        aws: this.aws,
      }),
    ));
    const hasCustomHeaders = content.headers != null && Object.keys(content.headers).length > 0;

    try {
      if ((content.attachments && content.attachments.length > 0) || hasCustomHeaders) {
        return await this.sendRaw({ client: sesClient, content, defaultFrom });
      }
      return await this.sendSimple({ client: sesClient, content, defaultFrom });
    } catch (error) {
      logger.error({ error }, "Error sending email with SES");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.client?.destroy();
    this.client = undefined;
  }

  private async sendRaw({
    client,
    content,
    defaultFrom,
  }: {
    client: SESClient;
    content: EmailContent;
    defaultFrom: string;
  }) {
    const from = content.from ?? defaultFrom;
    const toAddresses = EmailGatewayPort.recipients(content.to);
    const allDestinations = [...toAddresses, ...EmailGatewayPort.recipients(content.bcc)];
    const rawMessage = this.mime.buildRawMessage({
      from,
      to: toAddresses,
      replyTo: content.replyTo,
      subject: content.subject,
      html: content.html,
      headers: content.headers,
      attachments: content.attachments ?? [],
    });
    const data = await client.send(
      new SendRawEmailCommand({
        RawMessage: { Data: new TextEncoder().encode(rawMessage) },
        Destinations: allDestinations,
      }),
    );
    logger.info(
      { messageId: data.MessageId, recipientCount: allDestinations.length },
      "Email with attachments sent successfully",
    );
    return data;
  }

  private async sendSimple({
    client,
    content,
    defaultFrom,
  }: {
    client: SESClient;
    content: EmailContent;
    defaultFrom: string;
  }) {
    const from = content.from ?? defaultFrom;
    const toAddresses = EmailGatewayPort.recipients(content.to);
    const bccAddresses = EmailGatewayPort.recipients(content.bcc);
    const data = await client.send(
      new SendEmailCommand({
        Destination: {
          ToAddresses: toAddresses,
          ...(bccAddresses.length > 0 ? { BccAddresses: bccAddresses } : {}),
        },
        Message: {
          Body: { Html: { Charset: "UTF-8", Data: content.html } },
          Subject: { Charset: "UTF-8", Data: content.subject },
        },
        Source: from,
        ...(content.replyTo ? { ReplyToAddresses: [content.replyTo] } : {}),
      }),
    );
    logger.info(
      { messageId: data.MessageId, recipientCount: toAddresses.length },
      "Email sent successfully",
    );
    return data;
  }
}

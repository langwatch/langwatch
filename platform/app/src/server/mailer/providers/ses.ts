import {
  SESClient,
  type SESClientConfig,
  SendEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import { createLogger } from "@langwatch/observability";
import { buildRawMimeMessage } from "./mime";
import {
  type EmailContent,
  type EmailProviderPort,
  type MailerConfiguration,
  toArray,
} from "./types";

const logger = createLogger("langwatch:mailer:ses");

export interface SesAwsClientConfiguration {
  build(input: { region?: string; targetHost: string; endpoint?: string }): SESClientConfig;
}

/** Public regional SES endpoint, used to decide proxy applicability. */
const defaultSesHost = (region: string) =>
  `email.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;

export const buildSesClientConfig = ({
  configuration,
  aws,
}: {
  configuration: MailerConfiguration["ses"];
  aws: SesAwsClientConfiguration;
}): SESClientConfig => {
  const { region, endpoint } = configuration;
  // Credentials come from the default chain: SES has always run on the
  // deployment's own identity. The SDK's retries stay on, because an alert
  // send has no ladder above it to take them over.
  return aws.build({
    region,
    targetHost: endpoint ?? defaultSesHost(region ?? ""),
    endpoint,
  });
};

/** One lazy SES client per mailer process. Its borrowed handler is released by AWS shutdown. */
export class SesEmailProvider implements EmailProviderPort {
  readonly name = "ses" as const;

  static create(input: {
    configuration: MailerConfiguration["ses"];
    aws: SesAwsClientConfiguration;
  }): SesEmailProvider {
    return new SesEmailProvider(input.configuration, input.aws);
  }

  private client: SESClient | undefined;

  private closed = false;

  private constructor(
    private readonly configuration: MailerConfiguration["ses"],
    private readonly aws: SesAwsClientConfiguration,
  ) {}

  async send({ content, defaultFrom }: { content: EmailContent; defaultFrom: string }) {
    if (this.closed) throw new Error("SES email provider is closed.");
    logger.info("Sending email using AWS SES");
    const sesClient = (this.client ??= new SESClient(
      buildSesClientConfig({ configuration: this.configuration, aws: this.aws }),
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
    const toAddresses = toArray(content.to);
    const allDestinations = [...toAddresses, ...toArray(content.bcc)];
    const rawMessage = buildRawMimeMessage({
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
    const toAddresses = toArray(content.to);
    const bccAddresses = toArray(content.bcc);
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

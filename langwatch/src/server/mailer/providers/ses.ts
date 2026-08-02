import {
  SESClient,
  type SESClientConfig,
  SendEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import { createLogger } from "@langwatch/observability";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import { env } from "../../../env.mjs";
import { buildRawMimeMessage } from "./mime";
import { hostnameOf, resolveProxyForHost } from "./proxy";
import { type EmailContent, type EmailProviderPort, toArray } from "./types";

const logger = createLogger("langwatch:mailer:ses");

/** Public regional SES endpoint, used to decide proxy applicability. */
const defaultSesHost = (region: string) => `email.${region}.amazonaws.com`;

/**
 * A proxy agent owns a socket pool, so building one per send would accumulate
 * pools and file descriptors under a burst of alerts. They are keyed by proxy
 * URL and reused; the set of distinct URLs in a process is effectively one.
 */
const requestHandlers = new Map<string, NodeHttpHandler>();

const proxyRequestHandler = (proxyUrl: string): NodeHttpHandler => {
  const cached = requestHandlers.get(proxyUrl);
  if (cached) return cached;

  const agent = new HttpsProxyAgent(proxyUrl);
  const handler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent });
  requestHandlers.set(proxyUrl, handler);
  return handler;
};

export const buildSesClientConfig = (): SESClientConfig => {
  const region = env.AWS_REGION;
  const config: SESClientConfig = { region };

  const endpoint = env.AWS_SES_ENDPOINT;
  if (endpoint) {
    config.endpoint = endpoint;
  }

  // The AWS SDK ignores HTTPS_PROXY unless we hand it a request handler that
  // dials through the proxy. Without this, a pod whose only egress is a
  // corporate proxy fails with a TLS read timeout.
  const targetHost = endpoint
    ? hostnameOf(endpoint)
    : defaultSesHost(region ?? "");
  const proxyUrl = resolveProxyForHost(targetHost);
  if (proxyUrl) {
    config.requestHandler = proxyRequestHandler(proxyUrl);
  }

  return config;
};

export const sesProvider: EmailProviderPort = {
  name: "ses",
  async send(content: EmailContent, defaultFrom: string) {
    logger.info("Sending email using AWS SES");
    const sesClient = new SESClient(buildSesClientConfig());
    const from = content.from ?? defaultFrom;
    const toAddresses = toArray(content.to);
    const bccAddresses = toArray(content.bcc);
    const replyToAddresses = content.replyTo ? [content.replyTo] : undefined;

    const hasCustomHeaders =
      content.headers != null && Object.keys(content.headers).length > 0;

    try {
      if (
        (content.attachments && content.attachments.length > 0) ||
        hasCustomHeaders
      ) {
        // BCC recipients are NOT written into the MIME headers — SES uses the
        // envelope `Destinations` from `SendRawEmail` to deliver them invisibly,
        // so `buildRawMimeMessage` intentionally receives no bcc and renders no
        // `Bcc:` header. Recipients only see the public To list. Custom headers
        // (List-Unsubscribe) also force this raw path — SendEmail can't carry
        // arbitrary headers.
        const rawMessage = buildRawMimeMessage({
          from,
          to: toAddresses,
          replyTo: content.replyTo,
          subject: content.subject,
          html: content.html,
          headers: content.headers,
          attachments: content.attachments ?? [],
        });

        // SES routes envelope to `Destinations`, which is the union of
        // To/Cc/Bcc — the MIME headers above do NOT carry a Bcc line, so
        // recipients only see the public To list. This is the canonical way
        // to BCC through SendRawEmail.
        const allDestinations = [...toAddresses, ...bccAddresses];
        const command = new SendRawEmailCommand({
          RawMessage: { Data: new TextEncoder().encode(rawMessage) },
          Destinations: allDestinations,
        });
        const data = await sesClient.send(command);
        logger.info(
          { messageId: data.MessageId, recipientCount: allDestinations.length },
          "Email with attachments sent successfully",
        );
        return data;
      }

      const command = new SendEmailCommand({
        Destination: {
          ToAddresses: toAddresses,
          ...(bccAddresses.length > 0 ? { BccAddresses: bccAddresses } : {}),
        },
        Message: {
          Body: { Html: { Charset: "UTF-8", Data: content.html } },
          Subject: { Charset: "UTF-8", Data: content.subject },
        },
        Source: from,
        ...(replyToAddresses ? { ReplyToAddresses: replyToAddresses } : {}),
      });
      const data = await sesClient.send(command);
      logger.info(
        { messageId: data.MessageId, recipientCount: toAddresses.length },
        "Email sent successfully",
      );
      return data;
    } catch (error) {
      logger.error({ error }, "Error sending email with SES");
      throw error;
    }
  },
};

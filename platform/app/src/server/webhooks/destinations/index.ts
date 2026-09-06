import { httpWebhookDestination } from "./httpWebhookDestination";
import { sqsWebhookDestination } from "./sqsWebhookDestination";
import type { WebhookDestination } from "./types";

/**
 * One endpoint's last hop, with whatever secrets it needs already decrypted.
 *
 * Built by the endpoint service, which owns the encryption, and consumed by
 * the delivery executor, which owns none of it. This type is the whole
 * contract between them, which is why the secret has a name that says what
 * it is and no reader has to guess whether it is still encrypted.
 */
export type WebhookDestinationConfig =
  | { kind: "http"; url: string }
  | {
      kind: "sqs";
      queueUrl: string;
      roleArn: string | null;
      externalId: string | null;
      accessKeyId: string | null;
      /** Decrypted. Never logged, never returned by any read surface. */
      secretAccessKey: string | null;
    };

/** The transport for one endpoint. */
export function webhookDestinationFor(
  config: WebhookDestinationConfig,
): WebhookDestination {
  switch (config.kind) {
    case "http":
      return httpWebhookDestination({ url: config.url });
    case "sqs":
      return sqsWebhookDestination({
        queueUrl: config.queueUrl,
        roleArn: config.roleArn,
        externalId: config.externalId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });
  }
}

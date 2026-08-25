/**
 * Where a webhook endpoint delivers, as constants both sides share.
 *
 * The browser needs the kinds and their labels to render the destination
 * choice and the list badge; the server needs the same kinds to validate and
 * store. They live here, framework-free and dependency-free, so the drawer
 * never has to reach into `server/` for them.
 */

/** The wire spelling, lowercase: the same strings appear in the database,
 *  the REST DTO, both SDKs and the CLI. */
export const WEBHOOK_DESTINATION_KINDS = ["http", "sqs"] as const;
export type WebhookDestinationKind = (typeof WEBHOOK_DESTINATION_KINDS)[number];

export function isWebhookDestinationKind(value: string): value is WebhookDestinationKind {
  return (WEBHOOK_DESTINATION_KINDS as readonly string[]).includes(value);
}

/** What a customer reads. Amazon writes it "Amazon SQS", so we do too. */
export const WEBHOOK_DESTINATION_LABELS: Record<WebhookDestinationKind, string> = {
  http: "HTTPS endpoint",
  sqs: "Amazon SQS queue",
};

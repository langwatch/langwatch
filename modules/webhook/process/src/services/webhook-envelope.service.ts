import {
  webhookEnvelopeFromSpendRow,
  type WebhookEnvelope,
  type WebhookSpendEventRow,
} from "@langwatch/webhook-contract";

export class WebhookEnvelopeService {
  private constructor() {}

  static create(): WebhookEnvelopeService {
    return new WebhookEnvelopeService();
  }

  static fromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope {
    return webhookEnvelopeFromSpendRow(row);
  }

  fromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope {
    return WebhookEnvelopeService.fromSpendRow(row);
  }
}

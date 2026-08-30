import type { WebhookSpendEventRow } from "../services/webhook-envelope.service";

export type WebhookEventsPage = {
  rows: WebhookSpendEventRow[];
  nextCursor: string | null;
};

export abstract class WebhookEventsRepository {
  abstract readEmittedEventsPage(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    types?: string[];
  }): Promise<WebhookEventsPage>;

  abstract tryReadEmittedEventById(input: {
    tenantIds: string[];
    id: string;
  }): Promise<WebhookSpendEventRow | null>;
}

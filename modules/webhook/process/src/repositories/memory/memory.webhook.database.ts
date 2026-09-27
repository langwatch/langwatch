import type { Instant } from "@langwatch/time";
import type { WebhookDeliveryOutcome, WebhookDestinationKind } from "@langwatch/webhook-contract";

export type MemoryWebhookEndpointRow = {
  id: string;
  organizationId: string;
  destinationKind: WebhookDestinationKind;
  url: string | null;
  sqsQueueUrl: string | null;
  sqsRoleArn: string | null;
  sqsExternalId: string | null;
  sqsAccessKeyId: string | null;
  sqsSecretAccessKeyEncrypted: string | null;
  secretEncrypted: string;
  previousSecretEncrypted: string | null;
  previousSecretExpiresAt: Instant | null;
  enabledEvents: string[];
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  disabledAt: Instant | null;
  failingSince: Instant | null;
  lastSuccessAt: Instant | null;
  lastFailureAt: Instant | null;
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
  archivedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
};

export type MemoryWebhookDeliveryRow = {
  id: string;
  organizationId: string;
  endpointId: string;
  dispatchId: string;
  attempt: number;
  eventCount: number;
  outcome: WebhookDeliveryOutcome;
  responseStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  firedAt: Instant;
};

/**
 * The rows the webhook repositories share when the module is installed over
 * memory: one endpoint registry and its delivery log, the same pairing a
 * single Postgres database holds them under in production.
 */
export class MemoryWebhookDatabase {
  readonly #endpoints = new Map<string, MemoryWebhookEndpointRow>();
  readonly #deliveries: MemoryWebhookDeliveryRow[] = [];
  #deliverySequence = 0;

  private constructor() {}

  static create(): MemoryWebhookDatabase {
    return new MemoryWebhookDatabase();
  }

  endpoints(): MemoryWebhookEndpointRow[] {
    return [...this.#endpoints.values()];
  }

  findEndpoint(id: string): MemoryWebhookEndpointRow | undefined {
    return this.#endpoints.get(id);
  }

  putEndpoint(row: MemoryWebhookEndpointRow): MemoryWebhookEndpointRow {
    this.#endpoints.set(row.id, row);

    return row;
  }

  deliveries(): MemoryWebhookDeliveryRow[] {
    return [...this.#deliveries];
  }

  nextDeliveryId(): string {
    this.#deliverySequence += 1;

    return `webhook_delivery_${this.#deliverySequence}`;
  }

  addDelivery(row: MemoryWebhookDeliveryRow): MemoryWebhookDeliveryRow {
    this.#deliveries.push(row);

    return row;
  }

  /** Drops delivery rows fired before the cutoff; answers the count removed. */
  pruneDeliveriesBefore(before: Instant): number {
    const kept = this.#deliveries.filter(
      (row) => row.firedAt.epochMilliseconds >= before.epochMilliseconds,
    );
    const removed = this.#deliveries.length - kept.length;
    this.#deliveries.length = 0;
    this.#deliveries.push(...kept);

    return removed;
  }
}

import {
  WebhookEventsRepositoryPort,
  type WebhookEventsPage,
} from "../../ports/webhook-events.port.ts";
import type { WebhookSpendEventRow } from "../../services/webhook-envelope.service.ts";

function idSuffixFor(status: WebhookSpendEventRow["status"]): string {
  return status === "settled" ? "settled" : status === "admitted" ? "admitted" : "completed";
}

/** The emitted-envelope log the memory twin runs, so the events reads can be
 *  driven without ClickHouse. Seeded through {@link put}: nothing in this
 *  package writes an event row itself, since projecting a gateway spend
 *  event is a ClickHouse concern the delivery worker owns. */
export class MemoryWebhookEventsRepository extends WebhookEventsRepositoryPort {
  readonly #rows: WebhookSpendEventRow[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryWebhookEventsRepository {
    return new MemoryWebhookEventsRepository();
  }

  /** Seeds one emitted event, newest reads first. */
  put(row: WebhookSpendEventRow): void {
    this.#rows.push(row);
  }

  async readEmittedEventsPage(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    types?: string[];
  }): Promise<WebhookEventsPage> {
    const start = input.cursor ? Number(input.cursor) : 0;
    const matching = this.#rows
      .filter((row) => input.tenantIds.includes(row.tenantId))
      .filter((row) => input.fromMs === undefined || row.occurredAt.epochMilliseconds >= input.fromMs)
      .filter((row) => input.toMs === undefined || row.occurredAt.epochMilliseconds < input.toMs)
      .sort((left, right) => right.occurredAt.epochMilliseconds - left.occurredAt.epochMilliseconds);
    const page = matching.slice(start, start + input.limit);

    return {
      rows: page,
      nextCursor: start + input.limit < matching.length ? String(start + input.limit) : null,
    };
  }

  async findEmittedEventById(input: {
    tenantIds: string[];
    id: string;
  }): Promise<WebhookSpendEventRow | null> {
    return (
      this.#rows.find(
        (row) =>
          input.tenantIds.includes(row.tenantId) &&
          `${row.gatewayRequestId}:${idSuffixFor(row.status)}` === input.id,
      ) ?? null
    );
  }
}

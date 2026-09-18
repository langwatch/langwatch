import type { WebhookClickHouseClientResolver } from "./clickhouse.webhook-events.repository.ts";

/** Adapts the routed process member to Webhook's tenant-resolved read client. */
export type WebhookRoutedClickHouse = Readonly<{
  query(input: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
  }): Promise<{ rows: unknown[] }>;
}>;

export function createWebhookClickHouseResolver(
  clickhouse: WebhookRoutedClickHouse,
): WebhookClickHouseClientResolver {
  return (tenantId) =>
    Promise.resolve({
      async query(input) {
        const result = await clickhouse.query({
          tenantId,
          sql: input.query,
          params: input.query_params,
        });
        return { json: async () => result.rows };
      },
    });
}

/**
 * The routed ClickHouse boundaries the production graph opens: the per-tenant
 * client its event store resolves through, the event-log client, and the one
 * routed query client that IS this process's `clickhouse` member. Nothing
 * executes; the composition is asserted on what it composed.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

type WorkerProcessClickHouse = {
  resolveClient: (tenantId: string) => Promise<never>;
  eventLogClient: () => never;
  queryClient: ClickHouseQueryClient;
};

export function createWorkerProcessClickHouse(
  overrides: Partial<Record<"insert" | "query" | "command", unknown>> = {},
): WorkerProcessClickHouse {
  const client = {
    insert: async () => undefined,
    query: async () => ({ json: async () => [] }),
    command: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };

  return {
    resolveClient: async () => client as never,
    eventLogClient: () => client as never,
    queryClient: client as never,
  };
}

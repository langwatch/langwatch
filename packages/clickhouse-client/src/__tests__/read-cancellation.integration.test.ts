/** @vitest-environment node */

/**
 * A read the app abandons must stop on the server, read back from `system.processes`.
 * Spec: specs/clickhouse/single-client-access.feature; ADR-197.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startTestClickHouseEndpoints } from "../clickhouse-test-endpoints.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import {
  ClickHouseClientFactory,
  type ClickHouseClientCreationInput,
  ClickHouseConnection,
} from "../connection.ts";
import type { QueryRequest } from "../query.ts";
import { RetryPolicy } from "../retry.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const REQUEST_TIMEOUT_MS = 1_500;
const STOP_DEADLINE_MS = 10_000;

/** A read that runs for many minutes on one thread and answers one row at its end, never sooner. */
function slowRead(marker: string): QueryRequest {
  return {
    tenantId: "",
    sql: `SELECT count() FROM numbers(100000000000) WHERE sipHash64(number) % 7 = 3 AND '${marker}' != ''`,
    settings: { max_threads: 1 },
    // A synthetic load on the server's own table function; no tenant owns it.
    SKIP_TENANT_CHECK: true,
  };
}

class TimedVendorFactory extends ClickHouseClientFactory<ClickHouseClient> {
  constructor(private readonly requestTimeoutMs: number) {
    super();
  }

  create(input: ClickHouseClientCreationInput): ClickHouseClient {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      request_timeout: this.requestTimeoutMs,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }
}

let endpointUrl: string;
let probe: ClickHouseClient;
const opened: ClickHouseConnection<ClickHouseClient>[] = [];

function routed({
  url,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  retries,
}: {
  url: string;
  requestTimeoutMs?: number;
  retries?: RetryPolicy;
}): ClickHouseQueryClient {
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({ shared: { url, cluster: "test" } }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => null },
    }),
    clientFactory: new TimedVendorFactory(requestTimeoutMs),
  });
  opened.push(connection);
  return new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
    retries,
  });
}

/** The server's query ids still running a statement that carries `marker`. */
async function runningIds(marker: string): Promise<string[]> {
  const result = await probe.query({
    query:
      "SELECT query_id FROM system.processes WHERE position(query, {marker:String}) > 0 " +
      "AND position(query, 'system.processes') = 0",
    query_params: { marker },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ query_id: string }>();
  return rows.map((row) => row.query_id);
}

async function untilStopped(marker: string): Promise<string[]> {
  const deadline = Date.now() + STOP_DEADLINE_MS;
  let running = await runningIds(marker);
  while (running.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    running = await runningIds(marker);
  }
  return running;
}

async function untilRunning(marker: string): Promise<void> {
  const deadline = Date.now() + STOP_DEADLINE_MS;
  while ((await runningIds(marker)).length === 0) {
    if (Date.now() > deadline) throw new Error(`"${marker}" never started on the server`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Samples the server while `task` runs: every query id seen, and the most seen at once. */
async function watched(marker: string, task: () => Promise<unknown>) {
  const seen = new Set<string>();
  let mostAtOnce = 0;
  let done = false;
  const sampler = (async () => {
    while (!done) {
      const ids = await runningIds(marker);
      for (const id of ids) seen.add(id);
      mostAtOnce = Math.max(mostAtOnce, ids.length);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const outcome = await task().then(
    () => ({ failed: false as const }),
    (error: unknown) => ({ failed: true as const, error }),
  );
  done = true;
  await sampler;
  return { outcome, seen, mostAtOnce };
}

describe("a routed read the app abandons", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "read-cancellation",
      names: ["shared"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("A ClickHouse endpoint was not provisioned");
    endpointUrl = endpoint.url;
    probe = createClient({ url: endpointUrl });
  }, 300_000);

  afterEach(async () => {
    await probe.command({
      query: "KILL QUERY WHERE position(query, {run:String}) > 0 SYNC",
      query_params: { run: RUN },
    });
  });

  afterAll(async () => {
    await Promise.all(opened.map((connection) => connection.closeOnce()));
    await probe?.close();
  }, 60_000);

  describe("when the read outlasts the client's request timeout", () => {
    /** @scenario "A read the app abandons stops running on the server" */
    it("stops on the server once the client times out", async () => {
      const marker = `${RUN}-timeout`;
      const client = routed({ url: endpointUrl });

      const { outcome, seen } = await watched(marker, () => client.query(slowRead(marker)));

      expect(outcome).toMatchObject({ failed: true, error: { message: "Timeout error." } });
      expect(seen.size).toBe(1);
      expect(await untilStopped(marker)).toEqual([]);
    });

    /** @scenario "A read the app abandons stops running on the server" */
    it("keeps running on the server when sent without the read-only settings", async () => {
      const marker = `${RUN}-control`;
      const plain = createClient({ url: endpointUrl, request_timeout: REQUEST_TIMEOUT_MS });
      try {
        const read = slowRead(marker);
        await expect(
          plain.query({ query: read.sql, clickhouse_settings: { max_threads: 1 } }),
        ).rejects.toThrow("Timeout error.");

        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(await runningIds(marker)).toHaveLength(1);
      } finally {
        await plain.close();
      }
    });
  });

  describe("when the caller aborts the read", () => {
    /** @scenario "A read the app abandons stops running on the server" */
    it("stops on the server once the signal fires", async () => {
      const marker = `${RUN}-abort`;
      const client = routed({ url: endpointUrl, requestTimeoutMs: 120_000 });
      const controller = new AbortController();

      const read = client.query({ ...slowRead(marker), signal: controller.signal });
      const failure = read.then(
        () => undefined,
        (error: unknown) => error,
      );
      await untilRunning(marker);
      controller.abort();

      expect(await failure).toBeInstanceOf(Error);
      expect(await untilStopped(marker)).toEqual([]);
    });
  });

  describe("when a read that timed out is retried", () => {
    /** @scenario "A timed-out read that is retried never runs twice on the server at once" */
    it("runs each attempt on the server alone, and none survives the last", async () => {
      const marker = `${RUN}-retry`;
      const retried: number[] = [];
      const client = routed({
        url: endpointUrl,
        retries: new RetryPolicy({
          maxAttempts: 3,
          baseDelayMs: 500,
          onRetry: ({ attempt }) => retried.push(attempt),
        }),
      });

      const { outcome, seen, mostAtOnce } = await watched(marker, () =>
        client.query(slowRead(marker)),
      );

      expect(outcome).toMatchObject({ failed: true, error: { message: "Timeout error." } });
      expect(retried).toEqual([0, 1]);
      expect(seen.size).toBe(3);
      expect(mostAtOnce).toBe(1);
      expect(await untilStopped(marker)).toEqual([]);
    });
  });
});

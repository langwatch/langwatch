/** @vitest-environment node */

/**
 * Coding-agent session rows against two mutually isolated ClickHouse endpoints,
 * projected and read through the routed `clickhouse` member the process hands
 * this repository. specs/private-dataplane/data-isolation.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnection,
  ClickHouseQueryClient,
  createTenantRouter,
  DEFAULT_CLICKHOUSE_SETTINGS,
  isTransientClickHouseError,
  parseRoutingTable,
  PRIVATE_ROUTE_ENV_PREFIX,
  routingDriver,
  type ClickHouseClientCreationInput,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  privateRouteOrgId,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { session } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";

const PRIVATE_ORGANIZATION = privateRouteOrgId("coding-agent-isolation-private");
const SHARED_ORGANIZATION = privateRouteOrgId("coding-agent-isolation-shared");
const PRIVATE_PROJECT = `proj-private-${randomUUID()}`;
const SHARED_PROJECT = `proj-shared-${randomUUID()}`;
/** Nothing listens on the discard port, so a statement routed here is refused at connect. */
const UNREACHABLE_URL = "http://127.0.0.1:9";

const directory: TenantDirectory = {
  organizationForTenant: async (tenantId) =>
    ({
      [PRIVATE_PROJECT]: PRIVATE_ORGANIZATION,
      [SHARED_PROJECT]: SHARED_ORGANIZATION,
    })[tenantId] ?? null,
};

class VendorFactory extends ClickHouseClientFactory<ClickHouseClient & { close(): Promise<void> }> {
  create(input: ClickHouseClientCreationInput): ClickHouseClient & { close(): Promise<void> } {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      clickhouse_settings: {
        ...DEFAULT_CLICKHOUSE_SETTINGS,
        date_time_input_format: "best_effort",
      },
    });
  }
}

function routedMember({ sharedUrl, privateUrl }: { sharedUrl: string; privateUrl: string }) {
  const table = parseRoutingTable({
    [`${PRIVATE_ROUTE_ENV_PREFIX}acme__${PRIVATE_ORGANIZATION}`]: privateUrl,
  });
  const configuration = ClickHouseConfigService.create().resolve({
    shared: { url: sharedUrl, cluster: "test" },
    privateRoutes: [...table.routes].map(([organizationId, url]) => ({
      organizationId,
      url,
      cluster: "test",
    })),
  });
  const connection = ClickHouseConnection.create({
    configuration,
    router: createTenantRouter({ table, directory }),
    clientFactory: new VendorFactory(),
  });
  const sessions = CodingAgentSessionClickHouseRepository.create({
    clickhouse: new ClickHouseQueryClient({ driver: routingDriver(connection) }),
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsService.create(),
    clock: { nowMs: () => Date.now() },
  });
  return { connection, sessions };
}

function sessionFor({ tenantId }: { tenantId: string }) {
  return session({ tenantId, sessionId: `session-${randomUUID()}`, startedAtMs: Date.now() });
}

function windowAround(startedAtMs: number) {
  return { fromMs: startedAtMs - 60_000, toMs: startedAtMs + 60_000 };
}

async function sessionIdsOn(
  client: ClickHouseClient,
  { tenantId }: { tenantId: string },
): Promise<string[]> {
  const result = await client.query({
    query: "SELECT SessionId FROM coding_agent_sessions WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return (await result.json<{ SessionId: string }>()).map((row) => row.SessionId);
}

let sharedProbe: ClickHouseClient;
let privateProbe: ClickHouseClient;
let routed: ReturnType<typeof routedMember>;
let down: ReturnType<typeof routedMember>;

describe("given one organization on a private ClickHouse instance and one on the shared instance", () => {
  beforeAll(async () => {
    const [shared, isolated] = await startTestClickHouseEndpoints({
      suite: "ch-coding-agent-isolation",
      names: ["shared", "private"],
      environment: process.env,
    });
    if (!shared || !isolated) throw new Error("Two ClickHouse endpoints were not provisioned");

    for (const endpoint of [shared, isolated]) {
      await migrateTestClickHouseOnce({
        url: endpoint.url,
        migrate: async () => {
          // CLICKHOUSE_CLUSTER switches every engine to its Replicated form,
          // which needs a Keeper no test server has.
          const previousCluster = process.env.CLICKHOUSE_CLUSTER;
          delete process.env.CLICKHOUSE_CLUSTER;
          try {
            await ClickHouseMigrateTask.createFromConfig({
              config: {
                buildTime: false,
                skipped: false,
                sharedUrl: endpoint.url,
                privateEndpoints: [],
                settings: {
                  coldStorageEnabled: false,
                  hotDayOverrides: {},
                  childEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
                },
              },
            }).execute();
          } finally {
            if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
          }
        },
      });
    }

    routed = routedMember({ sharedUrl: shared.url, privateUrl: isolated.url });
    down = routedMember({ sharedUrl: shared.url, privateUrl: UNREACHABLE_URL });
    sharedProbe = createClient({ url: shared.url });
    privateProbe = createClient({ url: isolated.url });
  }, 600_000);

  afterAll(async () => {
    await Promise.all([routed?.connection.closeOnce(), down?.connection.closeOnce()]);
    await Promise.all([sharedProbe?.close(), privateProbe?.close()]);
  }, 60_000);

  describe("when a session row is projected for the private-instance organization", () => {
    /** @scenario "Coding-agent sessions for a private-CH org land in the private instance only" */
    it("stores the session on the private instance and nowhere else", async () => {
      const row = sessionFor({ tenantId: PRIVATE_PROJECT });
      await routed.sessions.upsert(row, 30, []);

      expect(await sessionIdsOn(privateProbe, { tenantId: PRIVATE_PROJECT })).toContain(
        row.sessionId,
      );
      expect(await sessionIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT })).toEqual([]);
    });
  });

  describe("when the private-instance organization reads its session", () => {
    /** @scenario "Coding-agent session reads for a private-CH org come from the private instance only" */
    it("returns the session held only on the private instance", async () => {
      const row = sessionFor({ tenantId: PRIVATE_PROJECT });
      await routed.sessions.upsert(row, 30, []);
      expect(await sessionIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT })).toEqual([]);

      const read = await routed.sessions.findBySessionId({
        tenantId: PRIVATE_PROJECT,
        sessionId: row.sessionId,
        window: windowAround(row.startedAtMs),
      });

      expect(read?.sessionId).toBe(row.sessionId);
    });
  });

  describe("when the shared-instance organization reads the private organization's session id", () => {
    /** @scenario "Another org's coding-agent reads never see a private-CH org's sessions" */
    it("returns nothing", async () => {
      const row = sessionFor({ tenantId: PRIVATE_PROJECT });
      await routed.sessions.upsert(row, 30, []);

      const read = await routed.sessions.findBySessionId({
        tenantId: SHARED_PROJECT,
        sessionId: row.sessionId,
        window: windowAround(row.startedAtMs),
      });

      expect(read).toBeNull();
      expect(await sessionIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT })).toEqual([]);
    });
  });

  describe("when the private instance is unreachable", () => {
    /** @scenario "Coding-agent projection writes for a private-CH org fail retryably while its private instance is down" */
    it("fails the private write transiently, writes nothing shared, and still serves the shared organization", async () => {
      const privateRow = sessionFor({ tenantId: PRIVATE_PROJECT });
      const sharedRow = sessionFor({ tenantId: SHARED_PROJECT });

      await expect(down.sessions.upsert(privateRow, 30, [])).rejects.toSatisfy((error) =>
        isTransientClickHouseError({ error }),
      );
      expect(await sessionIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT })).toEqual([]);

      await down.sessions.upsert(sharedRow, 30, []);
      expect(await sessionIdsOn(sharedProbe, { tenantId: SHARED_PROJECT })).toContain(
        sharedRow.sessionId,
      );
    });
  });
});

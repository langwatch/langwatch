/**
 * @vitest-environment node
 *
 * Integration tests for private ClickHouse data isolation through the
 * event-sourcing pipeline. Uses 2 isolated ClickHouse endpoints and proves
 * that EventRepositoryClickHouse and SpanStorageClickHouseRepository
 * route data to the correct endpoint based on env var configuration. An
 * endpoint is a database on the local server natively, and a container in CI;
 * either way a client built for one cannot read the other's rows.
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  clickhouseEventLog,
  createClickHouseClient,
  createPoolRegistry,
  mappedTenantRouter,
  type ClickHouseClient as PkgClickHouseClient,
  type TenantTarget,
} from "@langwatch/clickhouse";
import type { CommittedEvent } from "@langwatch/event-sourcing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpanInsertData } from "~/server/app-layer/traces/types";
import { prisma } from "~/server/db";
import { startTestClickHouseEndpoints } from "~/test-utils/clickhouseTestEndpoints";
import type { ClickHouseClientResolver } from "../clickhouseClient";

let sharedClient: ClickHouseClient;
let privateClient: ClickHouseClient;
let sharedTarget: TenantTarget;
let privateTarget: TenantTarget;

const PRIVATE_ORG_ID = `test-iso-priv-org-${nanoid(6)}`;
const SHARED_ORG_ID = `test-iso-shared-org-${nanoid(6)}`;

// Set the private CH env var BEFORE importing clickhouseClient module
// so parsePrivateClickHouseEnvVars() picks it up at module load.
// The URL will be set in beforeAll once the container is started.

/**
 * Mock the shared client module to return our shared test container client.
 */
vi.mock("../client", () => ({
  _getSharedClickHouseClient: () => sharedClient,
}));

// Both DDLs below stay unqualified: each endpoint's client carries its own
// database in the connection URL, and that separation is what these tests
// assert: a repository can only reach the database its resolved client
// was built for.
const EVENT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS event_log
(
    TenantId String,
    IdempotencyKey String,
    AggregateType String,
    AggregateId String,
    EventId String,
    EventType String,
    EventVersion String,
    EventTimestamp UInt64,
    CreatedAt DateTime64(3) DEFAULT now64(3),
    EventPayload String,
    ProcessingTraceparent String DEFAULT '',
    EventOccurredAt UInt64 DEFAULT 0
)
ENGINE = ReplacingMergeTree(EventTimestamp)
ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)
SETTINGS index_granularity = 8192;
`;

const STORED_SPANS_DDL = `
CREATE TABLE IF NOT EXISTS stored_spans
(
    ProjectionId String,
    TenantId String,
    TraceId String,
    SpanId String,
    ParentSpanId Nullable(String),
    ParentTraceId Nullable(String),
    ParentIsRemote Nullable(UInt8),
    Sampled UInt8,
    StartTime DateTime64(3),
    EndTime DateTime64(3),
    DurationMs UInt64,
    SpanName String,
    SpanKind UInt8,
    ServiceName String,
    ResourceAttributes Map(String, String),
    SpanAttributes Map(String, String),
    StatusCode Nullable(UInt8),
    StatusMessage Nullable(String),
    ScopeName String,
    ScopeVersion Nullable(String),
    \`Events.Timestamp\` Array(DateTime64(3)),
    \`Events.Name\` Array(String),
    \`Events.Attributes\` Array(Map(String, String)),
    \`Links.TraceId\` Array(String),
    \`Links.SpanId\` Array(String),
    \`Links.Attributes\` Array(Map(String, String)),
    DroppedAttributesCount UInt32 DEFAULT 0,
    DroppedEventsCount UInt32 DEFAULT 0,
    DroppedLinksCount UInt32 DEFAULT 0,
    CreatedAt DateTime64(3) DEFAULT now64(3),
    UpdatedAt DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(StartTime)
ORDER BY (TenantId, TraceId, SpanId)
SETTINGS index_granularity = 8192;
`;

async function setupTestTables(client: ClickHouseClient): Promise<void> {
  await client.command({ query: EVENT_LOG_DDL });
  await client.command({ query: STORED_SPANS_DDL });
}

async function queryEventLog(
  client: ClickHouseClient,
  tenantId: string,
): Promise<Array<{ TenantId: string; EventId: string; AggregateId: string }>> {
  const result = await client.query({
    query: `SELECT TenantId, EventId, AggregateId FROM event_log WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function queryStoredSpans(
  client: ClickHouseClient,
  tenantId: string,
): Promise<Array<{ TenantId: string; SpanId: string; TraceId: string }>> {
  const result = await client.query({
    query: `SELECT TenantId, SpanId, TraceId FROM stored_spans WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return result.json();
}

/** `url` carries the database as its path, the way `CLICKHOUSE_URL` does. */
function parseTenantTarget(rawUrl: string): TenantTarget {
  const parsed = new URL(rawUrl);
  const database =
    decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "default";
  parsed.pathname = "/";
  return { url: parsed.toString(), database };
}

const createdProjectIds: string[] = [];
const createdTeamIds: string[] = [];
const createdOrgIds: string[] = [];

async function createTestOrgWithProject({
  namespace,
  organizationId,
}: {
  namespace: string;
  organizationId: string;
}): Promise<{ projectId: string; organizationId: string; teamId: string }> {
  const suffix = nanoid(6);

  const organization = await prisma.organization.create({
    data: {
      id: organizationId,
      name: `Test Isolation Org ${namespace}`,
      slug: `--test-iso-org-${namespace}-${suffix}`,
    },
  });

  const team = await prisma.team.create({
    data: {
      name: `Test Isolation Team ${namespace}`,
      slug: `--test-iso-team-${namespace}-${suffix}`,
      organizationId: organization.id,
    },
  });

  const project = await prisma.project.create({
    data: {
      name: `Test Isolation Project ${namespace}`,
      slug: `--test-iso-proj-${namespace}-${suffix}`,
      apiKey: `test-iso-key-${nanoid()}`,
      teamId: team.id,
      language: "en",
      framework: "test",
    },
  });

  createdProjectIds.push(project.id);
  createdTeamIds.push(team.id);
  createdOrgIds.push(organization.id);

  return {
    projectId: project.id,
    organizationId: organization.id,
    teamId: team.id,
  };
}

function makeCommittedEvent({
  tenantId,
  eventId,
  aggregateId,
}: {
  tenantId: string;
  eventId?: string;
  aggregateId?: string;
}): CommittedEvent {
  return {
    tenantId,
    aggregateType: "trace",
    aggregateId: aggregateId ?? `agg-${nanoid(8)}`,
    eventId: eventId ?? `evt-${nanoid(8)}`,
    eventType: "TraceIngested",
    eventVersion: "1",
    idempotencyKey: `idem-${nanoid(8)}`,
    occurredAt: Date.now(),
    payload: JSON.stringify({ test: true }),
  };
}

function makeSpanInsertData({
  tenantId,
  spanId,
  traceId,
}: {
  tenantId: string;
  spanId?: string;
  traceId?: string;
}): SpanInsertData {
  const now = Date.now();
  return {
    id: `proj-${nanoid(8)}`,
    tenantId,
    traceId: traceId ?? `trace-${nanoid(8)}`,
    spanId: spanId ?? `span-${nanoid(8)}`,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: now - 100,
    endTimeUnixMs: now,
    durationMs: 100,
    name: "test-span",
    kind: 1,
    resourceAttributes: {},
    spanAttributes: { "service.name": "test-service" },
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "test", version: null },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 0,
  };
}

describe("Private ClickHouse data isolation through event-sourcing repositories", () => {
  let privateProjectId: string;
  let sharedProjectId: string;

  beforeAll(async () => {
    const [shared, private_] = await startTestClickHouseEndpoints({
      suite: "ch-isolation",
      names: ["shared", "private"],
    });

    const sharedUrl = shared!.url;
    const privateUrl = private_!.url;
    sharedTarget = parseTenantTarget(sharedUrl);
    privateTarget = parseTenantTarget(privateUrl);

    // Set the private CH env var so the clickhouseClient module resolves it
    process.env[`CLICKHOUSE_URL__testcustomer__${PRIVATE_ORG_ID}`] = privateUrl;

    sharedClient = createClient({
      url: sharedUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

    privateClient = createClient({
      url: privateUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

    // Create test tables in both containers
    await Promise.all([
      setupTestTables(sharedClient),
      setupTestTables(privateClient),
    ]);

    // Create Prisma records for both orgs
    const [privateOrg, sharedOrg] = await Promise.all([
      createTestOrgWithProject({
        namespace: "private",
        organizationId: PRIVATE_ORG_ID,
      }),
      createTestOrgWithProject({
        namespace: "shared",
        organizationId: SHARED_ORG_ID,
      }),
    ]);

    privateProjectId = privateOrg.projectId;
    sharedProjectId = sharedOrg.projectId;
  }, 300_000);

  afterAll(async () => {
    // Clean up clickhouseClient caches
    const { clearCustomClientCache, clearProjectOrgCache } = await import(
      "../clickhouseClient"
    );
    await clearCustomClientCache();
    clearProjectOrgCache();

    // Clean up Prisma data
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: createdProjectIds } },
      });
    }
    if (createdTeamIds.length > 0) {
      await prisma.team.deleteMany({
        where: { id: { in: createdTeamIds } },
      });
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }

    await Promise.all([sharedClient?.close(), privateClient?.close()]);

    delete process.env[`CLICKHOUSE_URL__testcustomer__${PRIVATE_ORG_ID}`];
  }, 60_000);

  /**
   * Builds a ClickHouseClientResolver that uses getClickHouseClientForProject
   * and throws if the client is null (mirrors production wiring).
   */
  /**
   * One client that resolves each call's tenant to its own endpoint — the
   * shape the engine's event log is handed in production, so the routing
   * decision under test is the router's, not the caller's.
   */
  function buildRoutedClient(): PkgClickHouseClient {
    const registry = createPoolRegistry({
      create: (target: TenantTarget) =>
        createClickHouseClient({ url: target.url, database: target.database }),
      destroy: (client) => client.close(),
    });
    const router = mappedTenantRouter({
      fallback: sharedTarget,
      overrides: new Map([[privateProjectId, privateTarget]]),
    });
    const For = (tenantId: string) =>
      registry.acquire(router.resolve(tenantId));

    return {
      query: (options) => For(options.tenantId).query(options),
      stream: (options) => For(options.tenantId).stream(options),
      insert: (options) => For(options.tenantId).insert(options),
      close: () => registry.closeAll(),
    };
  }

  async function buildResolver(): Promise<ClickHouseClientResolver> {
    const { getClickHouseClientForProject } = await import(
      "../clickhouseClient"
    );
    return async (tenantId: string) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) {
        throw new Error(
          `No ClickHouse client resolved for tenantId: ${tenantId}`,
        );
      }
      return client;
    };
  }

  describe("the event log", () => {
    describe("when appending events for a private-CH org", () => {
      /** @scenario Events for a private-CH org are stored in the private instance */
      it("stores events in the private instance only", async () => {
        const log = clickhouseEventLog({ client: buildRoutedClient() });

        const event = makeCommittedEvent({ tenantId: privateProjectId });
        await log.append([event]);

        const privateRows = await queryEventLog(
          privateClient,
          privateProjectId,
        );
        expect(privateRows).toHaveLength(1);
        expect(privateRows[0]!.EventId).toBe(event.eventId);

        const sharedRows = await queryEventLog(sharedClient, privateProjectId);
        expect(sharedRows).toHaveLength(0);
      });
    });

    describe("when appending events for a shared-CH org", () => {
      it("stores events in the shared instance only", async () => {
        const log = clickhouseEventLog({ client: buildRoutedClient() });

        const event = makeCommittedEvent({ tenantId: sharedProjectId });
        await log.append([event]);

        const sharedRows = await queryEventLog(sharedClient, sharedProjectId);
        expect(sharedRows).toHaveLength(1);
        expect(sharedRows[0]!.EventId).toBe(event.eventId);

        const privateRows = await queryEventLog(privateClient, sharedProjectId);
        expect(privateRows).toHaveLength(0);
      });
    });
  });

  describe("SpanStorageClickHouseRepository", () => {
    describe("when inserting a span for a private-CH org", () => {
      /** @scenario Spans for a private-CH org go to the private instance only */
      it("stores the span in the private instance only", async () => {
        const { SpanStorageClickHouseRepository } = await import(
          "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository"
        );
        const resolver = await buildResolver();
        const repo = new SpanStorageClickHouseRepository(resolver);

        const span = makeSpanInsertData({ tenantId: privateProjectId });
        await repo.insertSpan(span);

        const privateRows = await queryStoredSpans(
          privateClient,
          privateProjectId,
        );
        expect(privateRows).toHaveLength(1);
        expect(privateRows[0]!.SpanId).toBe(span.spanId);

        const sharedRows = await queryStoredSpans(
          sharedClient,
          privateProjectId,
        );
        expect(sharedRows).toHaveLength(0);
      });
    });

    describe("when concurrent writes target different orgs", () => {
      /** @scenario Spans for a shared-CH org go to the shared instance only */
      /** @scenario Concurrent writes for different orgs route correctly */
      it("routes each write to the correct container", async () => {
        const { SpanStorageClickHouseRepository } = await import(
          "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository"
        );
        const resolver = await buildResolver();
        const repo = new SpanStorageClickHouseRepository(resolver);

        const privateSpan = makeSpanInsertData({
          tenantId: privateProjectId,
          spanId: `concurrent-priv-${nanoid(6)}`,
        });
        const sharedSpan = makeSpanInsertData({
          tenantId: sharedProjectId,
          spanId: `concurrent-shared-${nanoid(6)}`,
        });

        // Insert concurrently
        await Promise.all([
          repo.insertSpan(privateSpan),
          repo.insertSpan(sharedSpan),
        ]);

        // Private span lands in private container only
        const privateRows = await queryStoredSpans(
          privateClient,
          privateProjectId,
        );
        const privateSpanRow = privateRows.find(
          (r) => r.SpanId === privateSpan.spanId,
        );
        expect(privateSpanRow).toBeDefined();

        const privateInShared = await queryStoredSpans(
          sharedClient,
          privateProjectId,
        );
        const leakedPrivate = privateInShared.find(
          (r) => r.SpanId === privateSpan.spanId,
        );
        expect(leakedPrivate).toBeUndefined();

        // Shared span lands in shared container only
        const sharedRows = await queryStoredSpans(
          sharedClient,
          sharedProjectId,
        );
        const sharedSpanRow = sharedRows.find(
          (r) => r.SpanId === sharedSpan.spanId,
        );
        expect(sharedSpanRow).toBeDefined();

        const sharedInPrivate = await queryStoredSpans(
          privateClient,
          sharedProjectId,
        );
        const leakedShared = sharedInPrivate.find(
          (r) => r.SpanId === sharedSpan.spanId,
        );
        expect(leakedShared).toBeUndefined();
      });
    });
  });
});

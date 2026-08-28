// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @vitest-environment node */

import { vi } from "vitest";

// The dev `.env` sets IS_SAAS + BLOCK_LOCAL_HTTP_CALLS, and `ssrfProtection`
// reads both ONCE at module load to build its validator. The fixture server is
// on loopback, so without this the whole tier fails with an SSRF rejection on a
// developer machine while passing in CI, where the vars are unset. Hoisted
// because a `beforeAll` would run long after that module was evaluated.
vi.hoisted(() => {
  process.env.IS_SAAS = "false";
  process.env.BLOCK_LOCAL_HTTP_CALLS = "false";
});

import type { ClickHouseClient } from "@clickhouse/client";
import {
  AppGovernanceEventingAdapter,
  AppGovernanceEventingRuntime,
  AppIngestionPullExecutionRuntime,
  AppIngestionPullLifecycleRuntime,
  AppPulledUsageEventDispatcher,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import { AppIngestionPullWorkerAdapter } from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import http from "http";
import { nanoid } from "nanoid";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import type { App } from "~/server/app-layer/app";
import { AppGovernanceIngestionPullHost } from "~/server/app-layer/governance-ingestion-pull.host";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { GatewayBudgetClickHouseRepository } from "@langwatch/gateway-server";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  type DatabricksGeniePullConfig,
  DatabricksGeniePuller,
} from "@langwatch/enterprise-governance-server/testing";
import {
  GovernanceHttpPort,
  type GovernanceHttpResponse,
  type IngestionPullWorkerService,
  PostgresIngestionPullSourceAdapter,
} from "@langwatch/enterprise-governance-server";

const ns = `genie-${nanoid(8)}`;

class AppHttpPort extends GovernanceHttpPort {
  async fetch(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<GovernanceHttpResponse> {
    const response = await fetch(url, init);
    return response;
  }
}

const appHttp = new AppHttpPort();

function makePuller(options?: { maxRequests?: number }): DatabricksGeniePuller {
  return DatabricksGeniePuller.create(appHttp, options);
}

/** The window the pulled read is bounded by. Wide enough for a live pull. */
const WINDOW_FROM = new Date("2020-01-01T00:00:00.000Z");
const WINDOW_TO = new Date("2100-01-01T00:00:00.000Z");

/** Mirrors the adapter's own constant; asserted against, not imported by it. */
const WATERMARK_LAG_MS = 5 * 60 * 1000;

let ch: ClickHouseClient;
let chRepo: GatewayBudgetClickHouseRepository;
let testApp: App;
let worker: IngestionPullWorkerService;

/**
 * One pull, driven exactly as production drives it.
 *
 * The runtime is built per call rather than shared: each pull gets its own
 * outbox, so a test cannot accidentally read a row another test's dispatcher
 * was still working on.
 */
async function pullThroughTheRealPipeline(params: {
  sourceId: string;
  cursor: string | null;
}): Promise<{ nextCursor: string | null; eventCount: number }> {
  const eventSourcing = new EventSourcing({
    processStore: InMemoryProcessStore.createForTesting(),
    eventStore: EventStoreMemory.createForTesting(),
    // Consumers only run for a worker role, and the outbox dispatcher IS the
    // step under test — without this the intent would sit pending forever and
    // the ledger assertions would fail for a reason that has nothing to do
    // with the adapter.
    executionTarget: "all",
  });
  try {
    const installed = AppGovernanceEventingAdapter.create(
      eventSourcing,
      AppGovernanceEventingRuntime.create(
        AppIngestionPullExecutionRuntime.create(worker, chRepo, {
          count: () => undefined,
          observeDuration: () => undefined,
        }),
        AppIngestionPullLifecycleRuntime.create(
          prisma,
          testApp.projects,
          { nextRunAt: ({ after }) => after },
          false,
        ),
      ),
    ).register();
    const outcome = await worker.run({
      ...params,
      pulledUsage: AppPulledUsageEventDispatcher.create(installed.pulledUsage),
    });
    // The outbox dispatches on its own loop, and ClickHouse settles an async
    // insert after that. Both are real asynchrony rather than test slop, so
    // this waits long enough for a full workspace sweep's worth of intents.
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return outcome;
  } finally {
    await eventSourcing.close();
  }
}

/** The adapter's durable cursor, decoded. */
function decodeCursor(cursor: string | null): {
  sinceMs: number;
  spaceId: string | null;
  conversationId: string | null;
  sweepHadGap: boolean;
  spaceSetFingerprint: string | null;
  sweepStartedAtMs: number | null;
} {
  if (!cursor) throw new Error("expected a cursor");
  return JSON.parse(cursor) as {
    sinceMs: number;
    spaceId: string | null;
    conversationId: string | null;
    sweepHadGap: boolean;
    spaceSetFingerprint: string | null;
    sweepStartedAtMs: number | null;
  };
}

/** What the dedicated pulled read reports for a scope. */
function pulledTotalsFor(params: { tenantId: string; scopeIds: string[] }) {
  return chRepo.readPulledUsageTotals({
    tenantId: params.tenantId,
    scopeIds: params.scopeIds,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
}

/**
 * The OCSF audit rows one tenant holds, oldest first — deduplicated the way
 * production reads them.
 *
 * `governance_ocsf_events` is a `ReplacingMergeTree(LastUpdatedAt)` keyed on
 * `(TenantId, EventId)`, and collapsing happens at MERGE time, which may be
 * seconds away or never. A naked SELECT therefore returns one row per INSERT,
 * not one per event — so a message the lag window legitimately re-reads shows
 * up twice and a test asserting "recorded once" fails on a schedule nobody
 * controls.
 *
 * This mirrors `GovernanceOcsfEventsClickHouseRepository.findAll`: the
 * IN-tuple dedup against `max(LastUpdatedAt)`, which is the house pattern
 * precisely because the subquery selects only keys — `RawOcsfJson` is a heavy
 * column, and `LIMIT 1 BY` would materialise it for whole granules.
 *
 * Reading anything other than what production reads would make these tests
 * assert a view of the data no customer ever sees.
 */
async function ocsfRowsFor(tenantId: string) {
  const result = await ch.query({
    query: `
      SELECT EventId, ActorEmail, ActionName, TargetName, SourceType, RawOcsfJson
      FROM governance_ocsf_events
      WHERE TenantId = {tenantId:String}
        AND (TenantId, EventId, LastUpdatedAt) IN (
          SELECT TenantId, EventId, max(LastUpdatedAt)
          FROM governance_ocsf_events
          WHERE TenantId = {tenantId:String}
          GROUP BY TenantId, EventId
        )
      ORDER BY EventTime ASC, EventId ASC`,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return (await result.json()) as Array<{
    EventId: string;
    ActorEmail: string;
    ActionName: string;
    TargetName: string;
    SourceType: string;
    RawOcsfJson: string;
  }>;
}

/** The adapter's `extra` block, as it survived the round-trip into OCSF. */
function extensionOf(row: { RawOcsfJson: string }): Record<string, unknown> {
  const parsed = JSON.parse(row.RawOcsfJson) as {
    metadata: { extension: Record<string, unknown> };
  };
  return parsed.metadata.extension;
}

async function seedSource(params: {
  slug: string;
  pullConfig: Prisma.InputJsonObject;
}): Promise<{
  organizationId: string;
  teamId: string;
  sourceId: string;
  govProjectId: string;
}> {
  const organization = await prisma.organization.create({
    data: { name: `Genie Org ${params.slug}`, slug: `--genie-${params.slug}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `Genie Team ${params.slug}`,
      slug: `--genie-team-${params.slug}`,
      organizationId: organization.id,
    },
  });
  const source = await prisma.ingestionSource.create({
    data: {
      organizationId: organization.id,
      teamId: team.id,
      sourceType: "databricks_genie",
      name: `genie-source-${params.slug}`,
      ingestSecretHash: `hash-${params.slug}`,
      status: "awaiting_first_event",
      pullSchedule: "*/15 * * * *",
      parserConfig: params.pullConfig,
    },
  });
  const govProject = await testApp.projects.ensureInternal({
    organizationId: organization.id,
    kind: "internal_governance",
  });
  return {
    organizationId: organization.id,
    teamId: team.id,
    sourceId: source.id,
    govProjectId: govProject.id,
  };
}

async function dropTenant(tenantId: string): Promise<void> {
  for (const table of ["governance_ocsf_events", "gateway_budget_ledger_events"]) {
    await ch
      .command({
        query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      })
      .catch(() => {});
  }
}

async function cleanupOrg(organizationId: string): Promise<void> {
  await cleanupTestRows(prisma, [
    ["ingestionSource", { organizationId }],
    ["project", { team: { organizationId } }],
    ["team", { organizationId }],
    ["organization", { id: organizationId }],
  ]);
}

beforeAll(() => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("Test ClickHouse client not initialised");
  ch = client;
  testApp = installClickHouseTestApp({ resolveClient: async () => ch });
  chRepo = new GatewayBudgetClickHouseRepository(async () => ch);
  const featureFlags = MemoryFeatureFlagService.create();
  featureFlags.setFlag("release_pulled_usage_cost_enabled", true);
  worker = AppIngestionPullWorkerAdapter.create({
    sources: PostgresIngestionPullSourceAdapter.create(prisma),
    host: AppGovernanceIngestionPullHost.create(featureFlags),
    projects: testApp.projects,
    events: new AppGovernanceOcsfEventsAdapter(async () => ch),
  }).build();
});

afterAll(async () => {
  await clearClickHouseTestApp();
});

// ---------------------------------------------------------------------------
// The fixture workspace
// ---------------------------------------------------------------------------

/** Two users: one carrying an IdP object id, one provisioned without. */
const USERS: Record<string, Record<string, string | null>> = {
  "700000000000001": {
    id: "700000000000001",
    userName: "dana.hoffman@acme.test",
    externalId: "11111111-2222-3333-4444-555555555555",
    displayName: "Dana Hoffman",
  },
  "700000000000002": {
    id: "700000000000002",
    userName: "priya.nair@acme.test",
    // Absent, exactly as it is for accounts created before SCIM was wired.
    externalId: null,
    displayName: "Priya Nair",
  },
};

/** Nobody the directory knows — every SCIM lookup for this id 404s. */
const DELETED_USER_ID = 799_999_999_999_999;

const SPACE_TITLES: Record<string, string> = {
  "space-alpha": "ACME Revenue Analyst",
  "space-beta": "ACME Trip Analytics",
  "space-forbidden": "ACME Restricted",
  "space-loop": "ACME Broken Pagination",
  "space-orphan": "ACME Departed Analyst",
};

function sqlAttachment(id: string, query: string, rowCount: number) {
  return {
    attachment_id: id,
    query: {
      query,
      description: "generated by genie",
      statement_id: `stmt-${id}`,
      query_result_metadata: { row_count: rowCount },
    },
  };
}

function message(params: {
  id: string;
  conversationId: string;
  spaceId: string;
  userId: number;
  content: string;
  createdMs: number;
  sql: string;
}) {
  return {
    message_id: params.id,
    conversation_id: params.conversationId,
    space_id: params.spaceId,
    user_id: params.userId,
    content: params.content,
    status: "COMPLETED",
    created_timestamp: params.createdMs,
    attachments: [
      { attachment_id: `txt-${params.id}`, text: { content: "Here you go." } },
      sqlAttachment(params.id, params.sql, 5),
    ],
  };
}

/**
 * A fixture Genie workspace.
 *
 * Built per suite rather than shared, because two of the scenarios below
 * mutate it mid-sweep and one of them 403s — state leaking between them would
 * make the failures mean the wrong thing.
 */
function createFixtureWorkspace(options: { betaAgeMs?: number } = {}) {
  const now = Date.now();
  /** Older activity, in the space the sweep visits first. */
  const alphaMs = now - 60 * 60 * 1000;
  /**
   * Newer activity, in a space the sweep only reaches later.
   *
   * The race scenario shortens this deliberately. It needs the LATER space's
   * message to be the newest thing the sweep sees while still sitting inside
   * the watermark's lag window — that combination is what separates a
   * start-anchored watermark from a max-seen one.
   */
  const betaMs = now - (options.betaAgeMs ?? 30 * 60 * 1000);

  const conversations: Record<
    string,
    Array<{ conversation_id: string; title: string; created_timestamp: number }>
  > = {
    // Two conversations across TWO pages, so a puller that ignores the
    // conversation page token sees only the first.
    "space-alpha": [
      {
        conversation_id: "conv-alpha-1",
        title: "Top products",
        created_timestamp: alphaMs,
      },
      {
        conversation_id: "conv-alpha-2",
        title: "Revenue by region",
        created_timestamp: alphaMs,
      },
    ],
    "space-beta": [
      {
        conversation_id: "conv-beta-1",
        title: "Trip distance",
        created_timestamp: betaMs,
      },
    ],
    "space-forbidden": [],
    "space-loop": [],
    // One conversation, several messages, all by someone the directory has
    // since deleted.
    "space-orphan": [
      {
        conversation_id: "conv-orphan-1",
        title: "Questions from a departed analyst",
        created_timestamp: alphaMs,
      },
    ],
  };

  const messages: Record<string, Array<ReturnType<typeof message>>> = {
    "conv-alpha-1": [
      message({
        id: "msg-alpha-1",
        conversationId: "conv-alpha-1",
        spaceId: "space-alpha",
        userId: 700_000_000_000_001,
        content: "What are the top 5 products by quantity sold?",
        createdMs: alphaMs,
        sql: "SELECT `product`, SUM(`quantity`) AS qty\nFROM `acme`.`sales`.`orders`\nGROUP BY `product`\nORDER BY qty DESC\nLIMIT 5",
      }),
    ],
    // On page TWO of this conversation's messages.
    "conv-alpha-2": [
      message({
        id: "msg-alpha-2",
        conversationId: "conv-alpha-2",
        spaceId: "space-alpha",
        userId: 700_000_000_000_001,
        content: "Revenue by region last quarter?",
        createdMs: alphaMs,
        sql: "SELECT `region`, SUM(`revenue`) FROM `acme`.`sales`.`orders` GROUP BY `region`",
      }),
      message({
        id: "msg-alpha-3",
        conversationId: "conv-alpha-2",
        spaceId: "space-alpha",
        userId: 700_000_000_000_002,
        content: "And the quarter before that?",
        createdMs: alphaMs + 1_000,
        sql: "SELECT `region`, SUM(`revenue`) FROM `acme`.`sales`.`orders` WHERE `quarter` = 'Q3' GROUP BY `region`",
      }),
    ],
    "conv-orphan-1": [1, 2, 3].map((n) =>
      message({
        id: `msg-orphan-${n}`,
        conversationId: "conv-orphan-1",
        spaceId: "space-orphan",
        userId: DELETED_USER_ID,
        content: `Question ${n} from an account that no longer exists`,
        createdMs: alphaMs + n,
        sql: "SELECT 1",
      }),
    ),
    "conv-beta-1": [
      message({
        id: "msg-beta-1",
        conversationId: "conv-beta-1",
        spaceId: "space-beta",
        userId: 700_000_000_000_002,
        content: "What was the average trip distance by pickup zip code?",
        createdMs: betaMs,
        sql: "SELECT `pickup_zip`, AVG(`trip_distance`) AS avg_distance\nFROM `samples`.`nyctaxi`.`trips`\nGROUP BY `pickup_zip`",
      }),
    ],
  };

  return { conversations, messages, alphaMs, betaMs };
}

type FixtureWorkspace = ReturnType<typeof createFixtureWorkspace>;

type FixtureOAuth = {
  accessToken?: string;
  status?: number;
  body?: unknown;
  hang?: boolean;
};

/**
 * Serves the fixture workspace over real HTTP, with the pagination, the 403 and
 * the broken page token the adapter has to survive.
 *
 * `onBeforeSpace` is the hook the concurrency scenario uses to inject activity
 * into an already-swept space while the sweep is still running.
 */
async function startFixtureServer(params: {
  workspace: FixtureWorkspace;
  onBeforeSpace?: (spaceId: string) => void;
  /**
   * Awaited before a conversation's messages are served. The budget-truncation
   * test uses it to make one message page slow, so a run's deadline crosses
   * WHILE the sweep is inside a space rather than cleanly between two.
   */
  onMessages?: (conversationId: string) => Promise<void> | void;
  /**
   * An HTTP status to force on a SCIM lookup, or undefined to answer normally.
   * The directory-outage test uses it to fail one lookup TRANSIENTLY and then
   * recover, which is the difference the adapter's cache has to respect.
   */
  onScim?: (userId: string) => number | undefined;
  /**
   * An HTTP status to force on one space's conversation listing, or one
   * conversation's messages. The loss-path tests use these to make a single
   * unit fail in isolation while the rest of the sweep carries on.
   */
  conversationsStatus?: (spaceId: string) => number | undefined;
  messagesStatus?: (conversationId: string) => number | undefined;
  /**
   * Reorders the space listing. The endpoint documents no ordering guarantee,
   * so the sort test uses this to return a different order on each run and
   * prove the walk imposes its own.
   */
  spacesOrder?: (spaceIds: string[]) => string[];
  /**
   * How the workspace answers a client-credentials sign-in. Absent means the
   * fixture has no token endpoint at all, which is what every pasted-token
   * test wants: an unrouted 404 makes an unexpected sign-in loud.
   */
  oauth?: FixtureOAuth;
}): Promise<{
  baseUrl: string;
  conversationRequests: string[];
  /** Space ids in the order their conversations were asked for. */
  conversationSpaceIds: string[];
  /** Space ids in the order the SERVER handed them to the walk. */
  spacesServed: string[];
  /** Requests per path prefix, for asserting a walk did not spin. */
  requestCounts: Map<string, number>;
  /** Decoded `clientId:clientSecret` per sign-in, in order. */
  oauthBasic: string[];
  /** Bearer tokens presented on Genie calls, in order. */
  bearersSeen: string[];
  close: () => Promise<void>;
}> {
  const { workspace } = params;
  const conversationRequests: string[] = [];
  /** Space ids in the order their conversations were asked for. */
  const conversationSpaceIds: string[] = [];
  const spacesServed: string[] = [];
  const requestCounts = new Map<string, number>();
  const oauthBasic: string[] = [];
  const bearersSeen: string[] = [];
  /** One conversation per page, so paging is exercised with tiny fixtures. */
  const CONVERSATION_PAGE = 1;
  const MESSAGE_PAGE = 1;

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      // A fixture handler should never throw, but if one ever does, answer 500
      // rather than let the rejection leak to `unhandledRejection` and flake a
      // later test in the file.
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("{}");
      }
    });
  });

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("page_token");
    requestCounts.set(url.pathname, (requestCounts.get(url.pathname) ?? 0) + 1);
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    const send = (body: unknown) => res.end(JSON.stringify(body));

    if (url.pathname === "/oidc/v1/token") {
      const oauth = params.oauth;
      if (!oauth) {
        // No token endpoint configured: an unrouted 404 rather than a silent
        // success, so a run that signs in when it should not is visible.
        res.statusCode = 404;
        send({ error: "no token endpoint" });
        return;
      }
      const header = req.headers.authorization ?? "";
      const basic = /^Basic (.+)$/.exec(header);
      if (basic) {
        oauthBasic.push(Buffer.from(basic[1]!, "base64").toString("utf8"));
      }
      if (oauth.hang) return; // never answers; the socket stays open
      if (oauth.status && oauth.status !== 200) {
        res.statusCode = oauth.status;
        send({ error: "invalid_client", error_description: "refused" });
        return;
      }
      send(
        oauth.body ?? {
          access_token: oauth.accessToken ?? "minted-token",
          token_type: "Bearer",
          expires_in: 3600,
        },
      );
      return;
    }

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (bearer) bearersSeen.push(bearer[1]!);

    if (url.pathname === "/api/2.0/genie/spaces") {
      const ids = params.spacesOrder
        ? params.spacesOrder(Object.keys(SPACE_TITLES))
        : Object.keys(SPACE_TITLES);
      if (spacesServed.length === 0) spacesServed.push(...ids);
      send({
        spaces: ids.map((space_id) => ({
          space_id,
          title: SPACE_TITLES[space_id] ?? null,
        })),
        next_page_token: null,
      });
      return;
    }

    const conversations = /^\/api\/2\.0\/genie\/spaces\/([^/]+)\/conversations$/.exec(
      url.pathname,
    );
    if (conversations) {
      const spaceId = conversations[1]!;
      params.onBeforeSpace?.(spaceId);
      conversationRequests.push(url.search);
      if (!url.searchParams.get("page_token")) conversationSpaceIds.push(spaceId);

      const forcedConversations = params.conversationsStatus?.(spaceId);
      if (forcedConversations !== undefined) {
        res.statusCode = forcedConversations;
        send({ error: `forced ${forcedConversations}` });
        return;
      }

      if (spaceId === "space-forbidden") {
        res.statusCode = 403;
        send({ error_code: "PERMISSION_DENIED", message: "no access" });
        return;
      }
      if (spaceId === "space-loop") {
        // Hands back the very token it was given. A puller that follows it
        // burns the whole run re-reading one page.
        send({ conversations: [], next_page_token: token ?? "stuck" });
        return;
      }
      // The real endpoint answers with the caller's own conversations when
      // include_all is absent. Mirroring that is the point of the fixture: an
      // adapter that dropped the flag must fail here, loudly, rather than
      // silently reporting one service account as the whole workspace.
      if (url.searchParams.get("include_all") !== "true") {
        send({ conversations: [], next_page_token: null });
        return;
      }

      const all = workspace.conversations[spaceId] ?? [];
      const offset = token ? Number(token) : 0;
      const slice = all.slice(offset, offset + CONVERSATION_PAGE);
      const next = offset + CONVERSATION_PAGE;
      send({
        conversations: slice,
        next_page_token: next < all.length ? String(next) : null,
      });
      return;
    }

    const messages =
      /^\/api\/2\.0\/genie\/spaces\/[^/]+\/conversations\/([^/]+)\/messages$/.exec(
        url.pathname,
      );
    if (messages) {
      const forcedMessages = params.messagesStatus?.(messages[1]!);
      if (forcedMessages !== undefined) {
        res.statusCode = forcedMessages;
        send({ error: `forced ${forcedMessages}` });
        return;
      }
      await params.onMessages?.(messages[1]!);
      const all = workspace.messages[messages[1]!] ?? [];
      const offset = token ? Number(token) : 0;
      const slice = all.slice(offset, offset + MESSAGE_PAGE);
      const next = offset + MESSAGE_PAGE;
      send({
        messages: slice,
        next_page_token: next < all.length ? String(next) : null,
      });
      return;
    }

    const scim = /^\/api\/2\.0\/preview\/scim\/v2\/Users\/([^/]+)$/.exec(url.pathname);
    if (scim) {
      const forced = params.onScim?.(scim[1]!);
      if (forced !== undefined) {
        res.statusCode = forced;
        send({ error: `forced ${forced}` });
        return;
      }
      const user = USERS[scim[1]!];
      if (!user) {
        res.statusCode = 404;
        send({ error: "not found" });
        return;
      }
      send(user);
      return;
    }

    res.statusCode = 404;
    send({ error: `unrouted ${url.pathname}` });
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    conversationRequests,
    conversationSpaceIds,
    spacesServed,
    requestCounts,
    oauthBasic,
    bearersSeen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function genieConfig(params: {
  baseUrl: string;
  spaceIds: string[];
  startingAt: string;
  /** Overrides the pasted token, for the sign-in tests. */
  credentials?: Record<string, string>;
}): Prisma.InputJsonObject {
  return {
    adapter: DATABRICKS_GENIE_ADAPTER_ID,
    workspaceUrl: params.baseUrl,
    spaceIds: params.spaceIds,
    startingAt: params.startingAt,
    schedule: "*/15 * * * *",
    credentials: params.credentials ?? { token: "fixture-token" },
  };
}

// ---------------------------------------------------------------------------

describe("given a Genie workspace the credential can fully read", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let seeded: Awaited<ReturnType<typeof seedSource>>;
  let firstCursor: string | null;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    fixture = await startFixtureServer({ workspace });
    seeded = await seedSource({
      slug: `ok-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-alpha", "space-beta"],
        startingAt: "2020-01-01T00:00:00.000Z",
      }),
    });
    firstCursor = (
      await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: null,
      })
    ).nextCursor;
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when the puller sweeps it", () => {
    /** @scenario "Every page of every list is read" */
    it("reads every page of every list, not just the first", async () => {
      const rows = await ocsfRowsFor(seeded.govProjectId);
      // One message sits on conversation page 2 and another on message page 2.
      // A puller that stops at the first page of either lands 1 or 2 rows.
      expect(rows.map((r) => r.EventId).sort()).toEqual(
        [
          `databricks_genie:${seeded.sourceId}:msg-alpha-1`,
          `databricks_genie:${seeded.sourceId}:msg-alpha-2`,
          `databricks_genie:${seeded.sourceId}:msg-alpha-3`,
          `databricks_genie:${seeded.sourceId}:msg-beta-1`,
        ].sort(),
      );
    });

    /** @scenario "One record per question, carrying the question and the SQL" */
    it("carries the question and the SQL it generated", async () => {
      const rows = await ocsfRowsFor(seeded.govProjectId);
      const alpha = rows.find((r) => r.EventId.endsWith("msg-alpha-1"))!;
      const extra = extensionOf(alpha);

      expect(alpha.ActionName).toBe("genie_query");
      expect(alpha.TargetName).toBe("ACME Revenue Analyst");
      expect(extra.question).toBe("What are the top 5 products by quantity sold?");
      expect(extra.generatedSql).toContain("`acme`.`sales`.`orders`");
      expect(extra.statementId).toBe("stmt-msg-alpha-1");
      expect(extra.rowCount).toBe(5);
    });

    /** @scenario "Every user's activity is captured, not just the caller's" */
    it("asks for every user's conversations, not just the caller's", () => {
      // The failure this guards is silent: without include_all the sweep
      // returns the service account's own conversations, reports success, and
      // under-reports the workspace forever with nothing looking wrong.
      expect(fixture.conversationRequests.length).toBeGreaterThan(0);
      for (const search of fixture.conversationRequests) {
        expect(search).toContain("include_all=true");
      }
    });

    /** @scenario "Identity resolves to the directory's object id when it has one" */
    it("keys a record on the IdP object id when the directory has one", async () => {
      const rows = await ocsfRowsFor(seeded.govProjectId);
      const withObjectId = extensionOf(
        rows.find((r) => r.EventId.endsWith("msg-alpha-1"))!,
      );

      expect(withObjectId.actorKey).toBe("11111111-2222-3333-4444-555555555555");
      expect(withObjectId.actorEmail).toBe("dana.hoffman@acme.test");
    });

    /** @scenario "Identity falls back to the login when there is no object id" */
    it("keys a record on the login when the directory has no object id", async () => {
      const rows = await ocsfRowsFor(seeded.govProjectId);
      const row = rows.find((r) => r.EventId.endsWith("msg-beta-1"))!;
      const withoutObjectId = extensionOf(row);

      // No object id in the directory, so the login carries the identity — and
      // the record is still attributed rather than anonymous.
      expect(withoutObjectId.actorExternalId).toBe("");
      expect(withoutObjectId.actorKey).toBe("priya.nair@acme.test");
      expect(row.ActorEmail).toBe("priya.nair@acme.test");
    });

    /** @scenario "A question costs nothing when no warehouse is named" */
    it("records the questions with no cost attached", async () => {
      const totals = await pulledTotalsFor({
        tenantId: seeded.govProjectId,
        scopeIds: [seeded.teamId, seeded.organizationId],
      });
      expect(totals.items).toBe(4);
      expect(totals.spentNanoUsd).toBe(0);
      expect(totals.spentUsd).toBe("0");
    });

    it("anchors the watermark to when the sweep began, not to the newest message", () => {
      const cursor = decodeCursor(firstCursor);
      // The bug this pins: a watermark set to the newest message seen sits
      // AFTER anything posted mid-sweep into an already-read space, and the
      // next run filters that activity out permanently.
      expect(cursor.sinceMs).toBeGreaterThan(workspace.betaMs);
      // Anchored near the sweep's start, minus the lag window it re-reads.
      expect(cursor.sinceMs).toBeLessThanOrEqual(Date.now() - WATERMARK_LAG_MS);
      expect(cursor.spaceId).toBeNull();
    });

    it("re-reads nothing when the workspace has not changed", async () => {
      const second = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: firstCursor,
      });
      expect(second.eventCount).toBe(0);
    }, 60_000);
  });
});

describe("given someone asks a question while a sweep is running", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let seeded: Awaited<ReturnType<typeof seedSource>>;

  beforeAll(async () => {
    // The later space's activity is recent, which is what makes this bite. The
    // injected message must be OLDER than the newest thing the sweep goes on
    // to see (so a max-seen watermark buries it) while still being newer than
    // the sweep's start minus the lag window (so a start-anchored watermark
    // catches it). With a 30-minute-old beta message neither holds and the
    // scenario proves nothing.
    workspace = createFixtureWorkspace({ betaAgeMs: 10_000 });
    let injected = false;
    fixture = await startFixtureServer({
      workspace,
      // Fires when the sweep moves on to the SECOND space, i.e. once the first
      // is already behind it. That is precisely the window in which a real
      // question can be missed.
      onBeforeSpace: (spaceId) => {
        if (spaceId !== "space-beta" || injected) return;
        injected = true;
        workspace.messages["conv-alpha-1"]!.push(
          message({
            id: "msg-alpha-late",
            conversationId: "conv-alpha-1",
            spaceId: "space-alpha",
            userId: 700_000_000_000_001,
            content: "Asked while the sweep was already past this space",
            // Two seconds BEFORE beta's message, in a space the sweep has
            // already walked past. A watermark set to the newest message seen
            // lands on beta's timestamp and filters this one out for good.
            createdMs: workspace.betaMs - 2_000,
            sql: "SELECT 1",
          }),
        );
      },
    });
    seeded = await seedSource({
      slug: `race-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-alpha", "space-beta"],
        startingAt: "2020-01-01T00:00:00.000Z",
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when the next sweep runs", () => {
    /** Rows after BOTH sweeps; the second deliberately overlaps the first. */
    let rowsAfterBothSweeps: Awaited<ReturnType<typeof ocsfRowsFor>>;
    /** Rows after the first sweep only. */
    let rowsAfterFirstSweep: Awaited<ReturnType<typeof ocsfRowsFor>>;

    beforeAll(async () => {
      const first = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: null,
      });
      rowsAfterFirstSweep = await ocsfRowsFor(seeded.govProjectId);
      await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: first.nextCursor,
      });
      rowsAfterBothSweeps = await ocsfRowsFor(seeded.govProjectId);
    }, 180_000);

    /** @scenario "Activity during a sweep is caught by the next one" */
    it("records the question the first sweep raced past", () => {
      // The property that gives this scenario its teeth, asserted rather than
      // assumed: the injected message must be OLDER than the newest message
      // the first sweep saw, or a max-seen watermark would have caught it too
      // and the scenario would prove nothing. A later edit to the fixture ages
      // fails here instead of quietly going decorative.
      const injected = workspace.messages["conv-alpha-1"]!.find(
        (m) => m.message_id === "msg-alpha-late",
      )!;
      const newestSeen = Math.max(
        ...Object.values(workspace.messages)
          .flat()
          .filter((m) => m.message_id !== "msg-alpha-late")
          .map((m) => m.created_timestamp),
      );
      expect(injected.created_timestamp).toBeLessThan(newestSeen);

      // Created after the sweep read that space, so the first run cannot have
      // it — and the second must.
      expect(rowsAfterFirstSweep.map((r) => r.EventId)).not.toContain(
        `databricks_genie:${seeded.sourceId}:msg-alpha-late`,
      );
      expect(rowsAfterBothSweeps.map((r) => r.EventId)).toContain(
        `databricks_genie:${seeded.sourceId}:msg-alpha-late`,
      );
    });

    /** @scenario "A re-read message is recorded once" */
    it("keeps a message read by both sweeps as a single record", () => {
      // The lag window means the second run deliberately re-reads part of the
      // first's, so this message arrived twice. It must still be ONE record —
      // the sinks dedup on the message id, which is what makes an overlapping
      // window safe to re-read in the first place.
      const reRead = rowsAfterBothSweeps.filter((r) => r.EventId.endsWith("msg-beta-1"));
      expect(reRead).toHaveLength(1);
    });
  });
});

describe("given one space the credential cannot read", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let seeded: Awaited<ReturnType<typeof seedSource>>;
  let outcome: { nextCursor: string | null; eventCount: number };

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    fixture = await startFixtureServer({ workspace });
    seeded = await seedSource({
      slug: `denied-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        // The unreadable space sits BETWEEN two readable ones, so a puller
        // that unwinds on the 403 loses the third as well as the first.
        spaceIds: ["space-alpha", "space-forbidden", "space-beta"],
        startingAt: "2020-01-01T00:00:00.000Z",
      }),
    });
    outcome = await pullThroughTheRealPipeline({
      sourceId: seeded.sourceId,
      cursor: null,
    });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when the sweep hits it", () => {
    /** @scenario "One unreadable space does not discard the others" */
    it("still records everything the readable spaces held", async () => {
      const rows = await ocsfRowsFor(seeded.govProjectId);
      expect(rows.map((r) => r.EventId).sort()).toEqual(
        [
          `databricks_genie:${seeded.sourceId}:msg-alpha-1`,
          `databricks_genie:${seeded.sourceId}:msg-alpha-2`,
          `databricks_genie:${seeded.sourceId}:msg-alpha-3`,
          `databricks_genie:${seeded.sourceId}:msg-beta-1`,
        ].sort(),
      );
    });

    /** @scenario "The watermark never moves past data that was not fetched" */
    it("holds the watermark, so nothing behind the failure is skipped", () => {
      // The sweep was incomplete, so the window must not advance — the next
      // run reads the same history again rather than stepping over whatever
      // the forbidden space was hiding.
      const cursor = decodeCursor(outcome.nextCursor);
      expect(cursor.sinceMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));
    });
  });
});

describe("given a list endpoint whose page token never advances", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let seeded: Awaited<ReturnType<typeof seedSource>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    fixture = await startFixtureServer({ workspace });
    seeded = await seedSource({
      slug: `loop-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-loop"],
        startingAt: "2020-01-01T00:00:00.000Z",
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when the puller reads it", () => {
    /** @scenario "Pagination that does not advance is refused" */
    it("refuses rather than re-reading the same page until the budget dies", async () => {
      const outcome = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: null,
      });

      // The refusal itself, not just its consequence. The old behaviour also
      // produced no events and held the watermark — it just burned all 400
      // requests getting there, which is what makes a broken workspace look
      // like a merely large one.
      const requests =
        fixture.requestCounts.get("/api/2.0/genie/spaces/space-loop/conversations") ?? 0;
      expect(requests).toBeGreaterThan(0);
      expect(requests).toBeLessThan(5);

      // The space is isolated, so the run itself survives — but it is
      // incomplete, and the watermark says so.
      expect(outcome.eventCount).toBe(0);
      expect(decodeCursor(outcome.nextCursor).sinceMs).toBe(
        Date.parse("2020-01-01T00:00:00.000Z"),
      );
    }, 60_000);
  });
});

describe("given messages by an author the directory no longer has", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let seeded: Awaited<ReturnType<typeof seedSource>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    fixture = await startFixtureServer({ workspace });
    seeded = await seedSource({
      slug: `orphan-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-orphan"],
        startingAt: "2020-01-01T00:00:00.000Z",
      }),
    });
    await pullThroughTheRealPipeline({
      sourceId: seeded.sourceId,
      cursor: null,
    });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when the puller resolves them", () => {
    /** @scenario "An author the directory no longer has is looked up once" */
    it("asks the directory once, and still records every question", async () => {
      // A deleted account 404s every time, so a lookup per message would turn
      // one departed analyst into a lookup per question they ever asked.
      const lookups =
        fixture.requestCounts.get(`/api/2.0/preview/scim/v2/Users/${DELETED_USER_ID}`) ??
        0;
      expect(lookups).toBe(1);

      // The questions still land. A missing author must cost the attribution,
      // never the visibility.
      const rows = await ocsfRowsFor(seeded.govProjectId);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(extensionOf(row).question).not.toBe("");
        expect(row.ActorEmail).toBe("");
      }
    });
  });
});

describe("given a sweep too large for one run's budget", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    fixture = await startFixtureServer({ workspace });
  });

  afterAll(async () => {
    await fixture.close();
  });

  describe("when it finishes on a later run", () => {
    /**
     * Driven through `runOnce` rather than the pipeline, because the deadline
     * is the only lever that truncates a sweep and `runIngestionPull` pins it
     * at five minutes. Everything under test here — the anchor, the resume,
     * the watermark — lives in the adapter, and the pipeline tiers above
     * already cover the path from an event to a row.
     */
    /** @scenario "A sweep cut short by its budget resumes where it stopped" */
    it("anchors the watermark to the FIRST run's start, not the last one's", async () => {
      const adapter = makePuller();
      const config = adapter.validateConfig({
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: fixture.baseUrl,
        spaceIds: ["space-alpha", "space-beta"],
        startingAt: "2020-01-01T00:00:00.000Z",
        schedule: "*/15 * * * *",
      });
      const credentials = { token: "fixture-token" };

      // Run one, with a deadline already behind it: the sweep starts, gets no
      // further than its first space, and hands the rest to the next run.
      const beforeFirstRun = Date.now();
      const first = await adapter.runOnce(
        { cursor: null, credentials, deadlineMs: Date.now() - 1 },
        config,
      );
      const afterFirstRun = Date.now();

      const truncated = decodeCursor(first.cursor);
      expect(truncated.spaceId).toBe("space-alpha");
      expect(truncated.sweepStartedAtMs).not.toBeNull();
      // Nothing was read, so the window must not have moved.
      expect(truncated.sinceMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));

      // A real gap between runs — the scheduler's interval, compressed. This
      // is the whole distance the bug hid in.
      await new Promise((resolve) => setTimeout(resolve, 1_500));

      const beforeSecondRun = Date.now();
      const second = await adapter.runOnce({ cursor: first.cursor, credentials }, config);

      const done = decodeCursor(second.cursor);

      // The assertion that bites, and it comes first so that it — rather than
      // the cursor's shape — is what fails if the anchor regresses. Anchored
      // to run ONE, the watermark cannot be later than when run one ended.
      // Anchored to run two, it lands at least the 1.5s gap beyond that, and
      // everything asked in space-alpha during the gap is filtered out for
      // good.
      expect(done.sinceMs).toBeGreaterThanOrEqual(beforeFirstRun - WATERMARK_LAG_MS);
      expect(done.sinceMs).toBeLessThanOrEqual(afterFirstRun - WATERMARK_LAG_MS);
      expect(done.sinceMs).toBeLessThan(beforeSecondRun - WATERMARK_LAG_MS);

      // The sweep drained, so the in-flight anchor is released.
      expect(done.spaceId).toBeNull();
      expect(done.sweepStartedAtMs).toBeNull();
    }, 60_000);
  });

  describe("when the budget is cut PARTWAY through a space", () => {
    /**
     * The test above cuts the run cleanly BETWEEN spaces — deadline already
     * behind, nothing read. This one cuts it INSIDE space-alpha: after its
     * first conversation's messages, before its second's. That is the case
     * that used to lose data. The sweep resumed at the NEXT space, skipping the
     * cut space's unread tail, and a later complete sweep then advanced the
     * watermark past those never-fetched messages — silently and for good.
     *
     * Regression: resume must land on the CUT space so its tail is re-read.
     */
    /** @scenario "A sweep cut short by its budget resumes where it stopped" */
    it("resumes at the cut space and loses no message from its tail", async () => {
      const workspace = createFixtureWorkspace();
      let slowedOnce = false;
      // Slow ONLY the first conversation's first message page, so the run's
      // deadline crosses while the sweep is still inside space-alpha rather
      // than at a tidy space boundary.
      const fixture = await startFixtureServer({
        workspace,
        onMessages: async (conversationId) => {
          if (conversationId === "conv-alpha-1" && !slowedOnce) {
            slowedOnce = true;
            await new Promise((resolve) => setTimeout(resolve, 1_500));
          }
        },
      });

      try {
        const adapter = makePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-alpha", "space-beta"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });
        const credentials = { token: "fixture-token" };

        // The three localhost requests before the slow page clear this deadline
        // easily; the 1.5s page does not. So the cut lands inside space-alpha.
        const first = await adapter.runOnce(
          { cursor: null, credentials, deadlineMs: Date.now() + 800 },
          config,
        );
        const firstCursor = decodeCursor(first.cursor);

        // The assertion that bites: resume is the CUT space, not the next one.
        // Before the fix this read "space-beta" and space-alpha's tail was gone.
        expect(firstCursor.spaceId).toBe("space-alpha");
        // Cut mid-space, so the window is held where it started.
        expect(firstCursor.sinceMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));

        // Run two, no deadline: resumes at space-alpha, re-reads its tail, and
        // drains the rest.
        const second = await adapter.runOnce(
          { cursor: first.cursor, credentials },
          config,
        );
        const secondCursor = decodeCursor(second.cursor);

        const emitted = new Set(
          [...first.events, ...second.events].map((e) => e.source_event_id),
        );
        // The whole workspace, with nothing dropped at the cut. msg-alpha-2 and
        // msg-alpha-3 are the tail of the cut space that used to vanish.
        for (const id of ["msg-alpha-1", "msg-alpha-2", "msg-alpha-3", "msg-beta-1"]) {
          expect(emitted).toContain(id);
        }
        // Only now that everything was read does the sweep finish and release.
        expect(secondCursor.spaceId).toBeNull();
        expect(secondCursor.sweepStartedAtMs).toBeNull();
      } finally {
        await fixture.close();
      }
    }, 60_000);
  });
});

/**
 * A directory that fails for a moment, not for good.
 *
 * The adapter caches a 404 — a deleted account is a permanent answer — but
 * must NOT cache anything else. Caching a 503 would take one unlucky instant
 * and strip the author off every remaining message in the run, which reads as
 * a workspace full of anonymous questions with nothing reporting a failure.
 */
describe("given the directory fails while the sweep is running", () => {
  describe("when a later message has the same author", () => {
    /** @scenario "A directory outage does not strip authors off the rest of the run" */
    it("asks the directory again rather than reusing the failure", async () => {
      const workspace = createFixtureWorkspace();
      const flakyUserId = "700000000000001";
      let lookups = 0;

      const fixture = await startFixtureServer({
        workspace,
        onScim: (userId) => {
          if (userId !== flakyUserId) return undefined;
          lookups += 1;
          // Only the FIRST lookup fails, and it fails transiently.
          return lookups === 1 ? 503 : undefined;
        },
      });

      try {
        const adapter = makePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-alpha"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });

        const result = await adapter.runOnce(
          { cursor: null, credentials: { token: "fixture-token" } },
          config,
        );

        const byId = new Map(
          result.events.map((event) => [event.source_event_id, event]),
        );
        const duringOutage = byId.get("msg-alpha-1");
        const afterOutage = byId.get("msg-alpha-2");
        expect(duringOutage).toBeDefined();
        expect(afterOutage).toBeDefined();

        // The assertion that bites: a second lookup happened at all. Cache the
        // transient failure and this stays at 1.
        expect(lookups).toBeGreaterThanOrEqual(2);

        // The message caught by the outage still lands, just unattributed —
        // an anonymous question is worth recording.
        expect(String(duringOutage?.extra?.actorEmail ?? "")).toBe("");
        // And the next message by the SAME author is attributed properly,
        // which is the half a cached failure would have destroyed.
        expect(String(afterOutage?.extra?.actorEmail ?? "")).toBe(
          "dana.hoffman@acme.test",
        );
      } finally {
        await fixture.close();
      }
    }, 60_000);
  });
});

/**
 * A gap and the watermark.
 *
 * The sweep deliberately walks past a unit it cannot read, so one unreadable
 * space cannot cost the workspace the others. The resume point therefore moves
 * BEYOND the hole, and nothing in the position alone remembers the hole was
 * left — which is why the cursor carries `sweepHadGap`. These tests pin both
 * halves: the window must not advance over a gap, and the gap must not stop the
 * rest of the workspace from being swept.
 *
 * The cut is driven by `maxRequests`, not by wall-clock. "The budget runs out
 * at the Nth request" is then a counted fact rather than a race, so these
 * cannot pass vacuously on a slow runner.
 */
describe("given the sweep walked past something it could not read", () => {
  const CONVERSATIONS = [1, 2, 3, 4];

  function gapWorkspace() {
    const alphaMs = Date.UTC(2026, 0, 6, 9, 0, 0);
    const conversations: Record<
      string,
      Array<{
        conversation_id: string;
        title: string;
        created_timestamp: number;
      }>
    > = {
      "space-solo": CONVERSATIONS.map((n) => ({
        conversation_id: `conv-s-${n}`,
        title: `Conversation ${n}`,
        created_timestamp: alphaMs,
      })),
    };
    const messages: Record<string, Array<ReturnType<typeof message>>> = {};
    for (const n of CONVERSATIONS) {
      messages[`conv-s-${n}`] = [
        message({
          id: `msg-s-${n}`,
          conversationId: `conv-s-${n}`,
          spaceId: "space-solo",
          userId: 700_000_000_000_001,
          content: `Question ${n}`,
          createdMs: alphaMs + n,
          sql: "SELECT 1",
        }),
      ];
    }
    return { conversations, messages, alphaMs, betaMs: alphaMs };
  }

  /** Runs until the sweep drains, or gives up loudly. */
  async function sweepToCompletion(params: {
    adapter: DatabricksGeniePuller;
    config: DatabricksGeniePullConfig;
    emitted: Set<string>;
    /** Continue an in-flight sweep rather than starting one. */
    from?: string | null;
    /** Every cursor written along the way, so a test can assert mid-sweep. */
    seen?: Array<ReturnType<typeof decodeCursor>>;
  }): Promise<{ drained: ReturnType<typeof decodeCursor>; cursor: string }> {
    let cursor: string | null = params.from ?? null;
    for (let run = 0; run < 30; run += 1) {
      const result = await params.adapter.runOnce(
        { cursor, credentials: { token: "fixture-token" } },
        params.config,
      );
      for (const event of result.events) {
        params.emitted.add(event.source_event_id);
      }
      cursor = result.cursor;
      const decoded = decodeCursor(cursor);
      params.seen?.push(decoded);
      if (decoded.spaceId === null) return { drained: decoded, cursor: cursor! };
    }
    throw new Error("sweep never drained");
  }

  describe("when the sweep finishes anyway", () => {
    it("holds the window rather than moving it over the hole", async () => {
      const workspace = gapWorkspace();
      let failing = true;
      const fixture = await startFixtureServer({
        workspace,
        messagesStatus: (conversationId) =>
          conversationId === "conv-s-2" && failing ? 429 : undefined,
      });

      try {
        // Small enough that the sweep spans several runs, so the gap has to
        // survive being carried across them.
        const adapter = makePuller({ maxRequests: 9 });
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-solo"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });
        const startedAt = Date.parse("2020-01-01T00:00:00.000Z");
        const emitted = new Set<string>();

        const seen: Array<ReturnType<typeof decodeCursor>> = [];
        const { drained, cursor: drainedCursor } = await sweepToCompletion({
          adapter,
          config,
          emitted,
          seen,
        });

        // The gap must be RECORDED while the sweep is still in flight — that
        // is the field doing the work. Asserting it on the drained cursor
        // proves nothing, since a finished sweep always clears it.
        expect(seen.length).toBeGreaterThan(1);
        expect(seen.some((c) => c.spaceId !== null && c.sweepHadGap)).toBe(true);

        // The assertion that bites. The sweep finished, but it never read
        // conv-s-2 — moving the window here would drop that message for good.
        expect(drained.sinceMs).toBe(startedAt);

        // Liveness: everything AFTER the hole was still swept. A resume point
        // pinned at the failure would starve these.
        expect(emitted).toContain("msg-s-3");
        expect(emitted).toContain("msg-s-4");

        // And once the conversation heals, the held window means the message is
        // still inside it and finally lands.
        failing = false;
        const healed = new Set<string>();
        // Continue from the cursor phase 1 actually wrote — starting fresh
        // would pass even if phase 1 had wrongly advanced the window.
        const { drained: after } = await sweepToCompletion({
          adapter,
          config,
          emitted: healed,
          from: drainedCursor,
        });
        expect(healed).toContain("msg-s-2");
        // No gap this time, so the window is finally allowed to move.
        expect(after.sinceMs).toBeGreaterThan(startedAt);
      } finally {
        await fixture.close();
      }
    }, 120_000);
  });

  describe("when a whole space stays unreadable", () => {
    it("keeps sweeping the spaces behind it instead of starving them", async () => {
      const workspace = createFixtureWorkspace();
      const fixture = await startFixtureServer({
        workspace,
        // space-alpha sorts first and never recovers.
        conversationsStatus: (spaceId) => (spaceId === "space-alpha" ? 403 : undefined),
      });

      try {
        // Three requests is deliberate: spaces list, space-alpha's 403, then
        // space-beta's conversation listing — and the budget dies before
        // beta's messages, so a resume point MUST be written. At a larger
        // budget the sweep drains in one run, no resume point is ever
        // recorded, and the test would pass against the starving version too.
        const adapter = makePuller({ maxRequests: 3 });
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-alpha", "space-beta"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });
        const startedAt = Date.parse("2020-01-01T00:00:00.000Z");
        const emitted = new Set<string>();

        const { drained } = await sweepToCompletion({
          adapter,
          config,
          emitted,
        });

        // The space behind the permanently broken one is still read. Resuming
        // AT the failure would pin the sweep there and this would never arrive.
        expect(emitted).toContain("msg-beta-1");
        // ...and the window stays put for as long as the hole is there.
        expect(drained.sinceMs).toBe(startedAt);
      } finally {
        await fixture.close();
      }
    }, 120_000);
  });
});

/**
 * A resume position with no sweep anchor.
 *
 * Cursors written before the anchor existed have exactly this shape. Honouring
 * the position while stamping a fresh anchor would skip every space before it
 * and then move the window from the new anchor — losing everything skipped.
 */
describe("given a cursor carrying a position but no sweep anchor", () => {
  describe("when the puller reads it", () => {
    it("ignores the position and sweeps the workspace from the top", async () => {
      const workspace = createFixtureWorkspace();
      const fixture = await startFixtureServer({ workspace });

      try {
        const adapter = makePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-alpha", "space-beta"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });

        const result = await adapter.runOnce(
          {
            // The pre-anchor shape: a position, no sweepStartedAtMs.
            cursor: JSON.stringify({
              sinceMs: Date.parse("2020-01-01T00:00:00.000Z"),
              spaceId: "space-beta",
            }),
            credentials: { token: "fixture-token" },
          },
          config,
        );

        const emitted = new Set(result.events.map((event) => event.source_event_id));
        // space-alpha sorts BEFORE the stale position. Honouring the position
        // would skip it entirely and the completing sweep would then move the
        // window past its messages.
        expect(emitted).toContain("msg-alpha-1");
        expect(emitted).toContain("msg-beta-1");
      } finally {
        await fixture.close();
      }
    }, 60_000);
  });
});

/**
 * The space walk's order is ours, not the workspace's.
 *
 * Resuming skips everything before the resume point, which is only sound if a
 * space cannot move across it between runs — and this endpoint carries no
 * ordering guarantee.
 */
describe("given the workspace lists its spaces in a different order each run", () => {
  describe("when a sweep resumes", () => {
    it("walks them in a stable order so a resume point cannot be jumped", async () => {
      const workspace = createFixtureWorkspace();
      const fixture = await startFixtureServer({
        workspace,
        // Hand them back REVERSED, which an endpoint with no documented order
        // is entitled to do from one run to the next.
        spacesOrder: (ids) => [...ids].reverse(),
      });

      try {
        const adapter = makePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          // Discovery path — the only one where the server's order reaches us.
          spaceIds: [],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });

        await adapter.runOnce(
          { cursor: null, credentials: { token: "fixture-token" } },
          config,
        );

        // The assertion that bites: the walk order is OURS. Take the server's
        // order and a resume point means a different thing on every run, so a
        // space can sit after it once and before it next time — read never,
        // and then dropped when the sweep completes.
        const walked = fixture.conversationSpaceIds;
        expect(walked.length).toBeGreaterThan(1);
        expect(walked).toEqual([...walked].sort());
        // ...and the server really did hand them over in the other order, so
        // the sort above is what produced this and not the fixture.
        expect(fixture.spacesServed).toEqual([...fixture.spacesServed].sort().reverse());
      } finally {
        await fixture.close();
      }
    }, 60_000);
  });
});
/**
 * One space bigger than a whole run's budget.
 *
 * Space-granular resume alone cannot finish this: every run would restart the
 * space at its first conversation, run out at roughly the same place, and the
 * sweep would never advance past it — so nothing behind it would ever be swept
 * either. Sub-space resume is what turns that stall into progress.
 */
describe("given one space too large for a single run's budget", () => {
  const BIG_CONVERSATIONS = [1, 2, 3, 4, 5];

  /** A space with several conversations, and one more space behind it. */
  function createOversizedWorkspace() {
    const alphaMs = Date.UTC(2026, 0, 5, 9, 0, 0);
    const conversations: Record<
      string,
      Array<{
        conversation_id: string;
        title: string;
        created_timestamp: number;
      }>
    > = {
      "space-big": BIG_CONVERSATIONS.map((n) => ({
        conversation_id: `conv-big-${n}`,
        title: `Big question ${n}`,
        created_timestamp: alphaMs,
      })),
      "space-tail": [
        {
          conversation_id: "conv-tail-1",
          title: "Behind the big one",
          created_timestamp: alphaMs,
        },
      ],
    };

    const messages: Record<string, Array<ReturnType<typeof message>>> = {
      "conv-tail-1": [
        message({
          id: "msg-tail-1",
          conversationId: "conv-tail-1",
          spaceId: "space-tail",
          userId: 700_000_000_000_002,
          content: "The question nobody reached",
          createdMs: alphaMs,
          sql: "SELECT 1",
        }),
      ],
    };
    for (const n of BIG_CONVERSATIONS) {
      messages[`conv-big-${n}`] = [
        message({
          id: `msg-big-${n}`,
          conversationId: `conv-big-${n}`,
          spaceId: "space-big",
          userId: 700_000_000_000_001,
          content: `Big question ${n}`,
          createdMs: alphaMs + n,
          sql: "SELECT 1",
        }),
      ];
    }

    return { conversations, messages, alphaMs, betaMs: alphaMs };
  }

  describe("when it is swept across several runs", () => {
    /** @scenario "A sweep cut short by its budget resumes where it stopped" */
    it("drains the oversized space and still reaches the space behind it", async () => {
      const workspace = createOversizedWorkspace();
      // Only message reads are slow, so the conversation LISTING always
      // completes inside a run. That matters: a truncated listing forfeits
      // sub-space resume by design, and this test is about the resume working.
      const fixture = await startFixtureServer({
        workspace,
        onMessages: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      });

      try {
        const adapter = makePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-big", "space-tail"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });
        const credentials = { token: "fixture-token" };

        const emitted = new Set<string>();
        // Comfortably more runs than convergence needs, so this fails as
        // "never finished" rather than hanging.
        const MAX_RUNS = 20;
        let cursor: string | null = null;
        let runs = 0;
        let converged = false;

        while (runs < MAX_RUNS && !converged) {
          const result = await adapter.runOnce(
            { cursor, credentials, deadlineMs: Date.now() + 350 },
            config,
          );
          runs += 1;
          for (const event of result.events) {
            emitted.add(event.source_event_id);
          }
          cursor = result.cursor;
          converged = decodeCursor(cursor).spaceId === null;
        }

        // The assertion that bites. With space-granular resume only, the sweep
        // restarts space-big every run, never drains it, and this stays false
        // until MAX_RUNS is spent.
        expect(converged).toBe(true);

        // Nothing in the oversized space was skipped on the way through...
        for (const n of BIG_CONVERSATIONS) {
          expect(emitted).toContain(`msg-big-${n}`);
        }
        // ...and the space behind it was actually reached, which is the part
        // the old behaviour starved indefinitely.
        expect(emitted).toContain("msg-tail-1");

        const final = decodeCursor(cursor);
        expect(final.spaceId).toBeNull();
        expect(final.conversationId).toBeNull();
        expect(final.sweepStartedAtMs).toBeNull();
        // A drained sweep is a complete sweep, so the window finally moves.
        expect(final.sinceMs).toBeGreaterThan(Date.parse("2020-01-01T00:00:00.000Z"));
      } finally {
        await fixture.close();
      }
    }, 120_000);
  });
});

/**
 * The unit of `created_timestamp` is not documented, and the two candidates
 * fail in opposite directions. Databricks' REST reference and its Genie guide
 * both example the field as `1719769718` — ten digits, seconds — while the rest
 * of the platform (Jobs, Dashboards) stamps milliseconds.
 *
 * Reading seconds as milliseconds is the dangerous half: every message lands in
 * January 1970, sits behind a first run's `now − 30 days` watermark, and the
 * source reports nothing at all with no error anywhere. So the adapter reads
 * either unit rather than betting on one, and this pins both.
 */
describe("given Databricks stamps created_timestamp in seconds", () => {
  /** Straight out of the published example response. */
  const DOCUMENTED_SECONDS = 1_719_769_718;

  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    // One message restamped in the wire format the docs publish. Everything
    // else in the fixture stays in milliseconds, so this run proves the two
    // units survive side by side rather than proving a global switch.
    workspace.messages["conv-beta-1"]![0]!.created_timestamp = DOCUMENTED_SECONDS;
    fixture = await startFixtureServer({ workspace });
  });

  afterAll(async () => {
    await fixture.close();
  });

  describe("when the sweep reads that message", () => {
    it("places it in 2024 rather than nineteen days after the epoch", async () => {
      const adapter = makePuller();
      const config = adapter.validateConfig({
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: fixture.baseUrl,
        spaceIds: ["space-beta"],
        // Before the documented instant, so the message is inside the window
        // when read correctly. Read as milliseconds it is 1970-01-20, which is
        // behind ANY watermark — including this one.
        startingAt: "2024-06-01T00:00:00.000Z",
        schedule: "*/15 * * * *",
      });

      const result = await adapter.runOnce(
        { cursor: null, credentials: { token: "fixture-token" } },
        config,
      );

      const beta = result.events.find((e) => e.source_event_id === "msg-beta-1");
      // The assertion that bites: on the old code there is no event at all,
      // because 1.7e9 milliseconds is behind the configured watermark.
      expect(beta).toBeDefined();
      expect(beta!.event_timestamp).toBe("2024-06-30T17:48:38.000Z");
    }, 60_000);
  });
});

/**
 * Genie fills `attachments` progressively — a message can be read back with the
 * question but without the generated SQL, which is the artefact this adapter
 * exists to capture. Both sinks replace on the message id, so a second read
 * corrects the first; the risk is that no second read ever happens, because a
 * completed sweep moves the watermark past a message that was never finished.
 */
describe("given a message still being answered when the sweep reads it", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    const inFlight = workspace.messages["conv-beta-1"]![0]!;
    // Mid-flight, exactly as Databricks serves it: the question is there, the
    // warehouse has not answered, so no query attachment exists yet.
    inFlight.status = "EXECUTING_QUERY";
    inFlight.attachments = [];
    fixture = await startFixtureServer({ workspace });
  });

  afterAll(async () => {
    await fixture.close();
  });

  describe("when it completes after that run", () => {
    it("holds the watermark so the generated SQL is still picked up", async () => {
      const adapter = makePuller();
      const config = adapter.validateConfig({
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: fixture.baseUrl,
        spaceIds: ["space-beta"],
        startingAt: "2020-01-01T00:00:00.000Z",
        schedule: "*/15 * * * *",
      });
      const credentials = { token: "fixture-token" };

      const first = await adapter.runOnce({ cursor: null, credentials }, config);

      // The record lands immediately — a question asked is a governance fact
      // whether or not the warehouse has answered — but with no SQL on it.
      const early = first.events.find((e) => e.source_event_id === "msg-beta-1");
      expect(early).toBeDefined();
      expect(early!.extra?.generatedSql).toBe("");

      // The assertion that bites. The sweep read every space and every
      // conversation, so on the old code it is "complete" and the watermark
      // moves past this message for good. It must stop just short of it
      // instead — far enough back that the next sweep reads it again.
      const held = decodeCursor(first.cursor);
      expect(held.sinceMs).toBeLessThan(workspace.betaMs);

      // Databricks finishes the answer between the two runs.
      const settled = workspace.messages["conv-beta-1"]![0]!;
      settled.status = "COMPLETED";
      settled.attachments = [
        sqlAttachment("late-beta-1", "SELECT `pickup_zip` FROM `trips`", 9),
      ];

      const second = await adapter.runOnce({ cursor: first.cursor, credentials }, config);

      const corrected = second.events.find((e) => e.source_event_id === "msg-beta-1");
      expect(corrected).toBeDefined();
      expect(corrected!.extra?.generatedSql).toBe("SELECT `pickup_zip` FROM `trips`");

      // Nothing is unsettled any more, so the window is finally allowed to move.
      const done = decodeCursor(second.cursor);
      expect(done.sinceMs).toBeGreaterThan(Date.parse("2020-01-01T00:00:00.000Z"));
    }, 60_000);
  });

  describe("when a DIFFERENT message is in flight on every sweep", () => {
    /**
     * The liveness half, and the reason holding the watermark cannot be a
     * boolean. A workspace with real traffic has something mid-answer almost
     * every time the sweep looks. If any unsettled message froze the whole
     * window, `sinceMs` would never advance on such a workspace: the re-read
     * window would grow by one interval every interval, without bound, until a
     * sweep could no longer finish inside its request budget.
     *
     * The window must hang back at the OLDEST thing still unsettled, not stop.
     */
    it("moves the window up to the oldest message still unsettled", async () => {
      const local = createFixtureWorkspace();
      const inFlight = local.messages["conv-beta-1"]![0]!;
      inFlight.status = "EXECUTING_QUERY";
      inFlight.attachments = [];
      const server = await startFixtureServer({ workspace: local });

      try {
        const adapter = makePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: server.baseUrl,
          spaceIds: ["space-beta"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });
        const credentials = { token: "fixture-token" };

        const first = await adapter.runOnce({ cursor: null, credentials }, config);

        // That one settles, and a newer question is asked and is still being
        // answered when the next sweep arrives. This is steady state, not an
        // edge case.
        inFlight.status = "COMPLETED";
        inFlight.attachments = [sqlAttachment("late-1", "SELECT 1", 1)];
        const secondMessageMs = Date.now();
        local.messages["conv-beta-1"]!.push({
          ...message({
            id: "msg-beta-2",
            conversationId: "conv-beta-1",
            spaceId: "space-beta",
            userId: 700_000_000_000_002,
            content: "And by drop-off zip?",
            createdMs: secondMessageMs,
            sql: "",
          }),
          status: "EXECUTING_QUERY",
          attachments: [],
        });

        const second = await adapter.runOnce(
          { cursor: first.cursor, credentials },
          config,
        );
        const after = decodeCursor(second.cursor);

        // The assertion that bites. A boolean hold leaves this at the
        // configured start forever, because there is always something in
        // flight; the window then grows without bound.
        expect(after.sinceMs).toBeGreaterThan(local.betaMs);

        // ...but not so far that the message still being answered falls out of
        // it, or its generated SQL is lost exactly as before.
        expect(after.sinceMs).toBeLessThan(secondMessageMs);
      } finally {
        await server.close();
      }
    }, 60_000);
  });
});

/**
 * The evidence tier. Read-only against a real workspace, and skipped whenever
 * the credential is absent — which is always, in CI.
 *
 * Run it with:
 *   DATABRICKS_GENIE_URL=https://<workspace-host> \
 *   DATABRICKS_GENIE_TOKEN=$(az account get-access-token \
 *     --resource 2ff814a6-3304-4ab8-85cb-cd0e6f879c1d --query accessToken -o tsv) \
 *   pnpm test:integration <this file>
 */
const liveToken = process.env.DATABRICKS_GENIE_TOKEN;
const liveUrl = process.env.DATABRICKS_GENIE_URL;

describe.skipIf(!liveToken || !liveUrl)("given the live Databricks workspace", () => {
  let seeded: Awaited<ReturnType<typeof seedSource>>;

  beforeAll(async () => {
    seeded = await seedSource({
      slug: `live-${ns}`,
      pullConfig: {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: liveUrl,
        // Empty: discover every space the credential can see, which is the
        // configuration a customer would actually run.
        spaceIds: [],
        // Wide enough to sweep the whole recorded history in one run.
        startingAt: "2020-01-01T00:00:00.000Z",
        schedule: "*/15 * * * *",
        credentials: { token: liveToken },
      },
    });
  });

  afterAll(async () => {
    // An evidence run is worth inspecting after the fact. `KEEP=1` leaves
    // the landed rows in place so a human can query them; the default still
    // cleans up, so a repeated run never reads the last one's leftovers.
    if (process.env.DATABRICKS_GENIE_KEEP === "1") {
      console.log(`[genie-live] kept tenant ${seeded.govProjectId}`);
      return;
    }
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when the puller sweeps every space it can see", () => {
    it("lands a visibility record for every Genie message in the workspace", async () => {
      const outcome = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: null,
      });
      expect(outcome.eventCount).toBeGreaterThan(0);

      const rows = await ocsfRowsFor(seeded.govProjectId);
      expect(rows).toHaveLength(outcome.eventCount);

      const totals = await pulledTotalsFor({
        tenantId: seeded.govProjectId,
        scopeIds: [seeded.teamId, seeded.organizationId],
      });
      expect(totals.items).toBe(outcome.eventCount);
      // Genie bills nothing per message, and the record must not invent one.
      expect(totals.spentNanoUsd).toBe(0);

      // Every message resolved to a person and carries a question. The SQL
      // is not asserted per row: a message can be answered in prose alone.
      for (const row of rows) {
        const extra = extensionOf(row);
        expect(extra.question).not.toBe("");
        expect(extra.actorKey).not.toBe("");
      }

      // A complete sweep of a healthy workspace must drain, not stop early.
      const cursor = decodeCursor(outcome.nextCursor);
      expect(cursor.spaceId).toBeNull();
      expect(cursor.sinceMs).toBeGreaterThan(0);

      const perSpace = new Map<string, number>();
      const identityShapes = { objectId: 0, loginFallback: 0 };
      for (const row of rows) {
        const extra = extensionOf(row);
        const title = String(extra.spaceTitle || extra.spaceId);
        perSpace.set(title, (perSpace.get(title) ?? 0) + 1);
        if (extra.actorExternalId) identityShapes.objectId += 1;
        else identityShapes.loginFallback += 1;
      }
      console.log(
        `[genie-live] ${rows.length} records across ${perSpace.size} spaces:`,
        Object.fromEntries(perSpace),
      );
      console.log("[genie-live] identity resolution:", identityShapes);
      const sample = extensionOf(rows[0]!);
      console.log("[genie-live] sample record:", {
        actorKey: sample.actorKey,
        actorEmail: sample.actorEmail,
        space: sample.spaceTitle,
        question: sample.question,
        sql: String(sample.generatedSql).slice(0, 160),
        costNanoUsd: 0,
      });
    }, 180_000);
  });
});

// ---------------------------------------------------------------------------
// @rule A source can sign in for itself, so a schedule outlives a pasted token
//
// A Databricks token expires about an hour after it is issued, so a source
// configured by pasting one is dead by the next morning. These cover the
// service-principal path that keeps a schedule running unattended.
// ---------------------------------------------------------------------------

/** A pull that only needs to be observed for its outcome, not its records. */
async function pullExpectingOutcome(params: { sourceId: string; cursor: string | null }) {
  return worker.run(params);
}

describe("given a source that signs in with a service principal", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let seeded: Awaited<ReturnType<typeof seedSource>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    fixture = await startFixtureServer({
      workspace,
      oauth: { accessToken: "minted-token" },
    });
    seeded = await seedSource({
      slug: `sp-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-alpha", "space-beta"],
        startingAt: "2020-01-01T00:00:00.000Z",
        credentials: {
          clientId: "sp-client-id",
          clientSecret: "sp-client-secret",
        },
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
  });

  describe("when a run starts", () => {
    let outcome: Awaited<ReturnType<typeof pullThroughTheRealPipeline>>;

    beforeAll(async () => {
      outcome = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: null,
      });
    }, 120_000);

    /** @scenario "A source given a client id and secret signs in for itself" */
    it("asks the workspace for a token with the client id and secret", () => {
      expect(fixture.oauthBasic).toEqual(["sp-client-id:sp-client-secret"]);
    });

    it("records the workspace's Genie activity", () => {
      expect(outcome.eventCount).toBeGreaterThan(0);
    });

    /** @scenario "Signing in happens once a run, not once a request" */
    it("signs in once a run, not once a request", () => {
      // The sweep reads several pages across several spaces; a token minted
      // per request would multiply this by the whole walk.
      expect(fixture.requestCounts.get("/oidc/v1/token")).toBe(1);
      expect(fixture.requestCounts.get("/api/2.0/genie/spaces") ?? 0).toBeGreaterThan(0);
    });

    it("presents the minted token on the Genie calls", () => {
      expect(new Set(fixture.bearersSeen)).toEqual(new Set(["minted-token"]));
    });
  });
});

describe("given a source holding a pasted token", () => {
  let workspace: FixtureWorkspace;
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;

  beforeAll(async () => {
    workspace = createFixtureWorkspace();
    // No `oauth` block at all: a sign-in would 404 and be impossible to miss.
    fixture = await startFixtureServer({ workspace });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
  });

  /** @scenario "A pasted token is still honoured" */
  it("does not ask the workspace for a token", async () => {
    const seeded = await seedSource({
      slug: `pasted-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-alpha"],
        startingAt: "2020-01-01T00:00:00.000Z",
      }),
    });
    try {
      await pullExpectingOutcome({ sourceId: seeded.sourceId, cursor: null });
      expect(fixture.requestCounts.get("/oidc/v1/token")).toBeUndefined();
      expect(new Set(fixture.bearersSeen)).toEqual(new Set(["fixture-token"]));
    } finally {
      await dropTenant(seeded.govProjectId);
      await cleanupOrg(seeded.organizationId);
    }
  }, 120_000);

  /** @scenario "A pasted token wins over a client secret" */
  it("prefers a pasted token over a client secret", async () => {
    // Someone pasting a token into a source that already had a secret is
    // rotating by hand, usually because the secret stopped working.
    const seeded = await seedSource({
      slug: `both-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-alpha"],
        startingAt: "2020-01-01T00:00:00.000Z",
        credentials: {
          token: "fixture-token",
          clientId: "sp-client-id",
          clientSecret: "sp-client-secret",
        },
      }),
    });
    try {
      await pullExpectingOutcome({ sourceId: seeded.sourceId, cursor: null });
      expect(fixture.requestCounts.get("/oidc/v1/token")).toBeUndefined();
    } finally {
      await dropTenant(seeded.govProjectId);
      await cleanupOrg(seeded.organizationId);
    }
  }, 120_000);
});

describe("given a source that cannot sign in", () => {
  let workspace: FixtureWorkspace;

  beforeAll(() => {
    workspace = createFixtureWorkspace();
  });

  /** Seeds, runs, and reports how the run ended. */
  async function runWith(params: {
    slug: string;
    credentials: Record<string, string>;
    oauth?: FixtureOAuth;
  }): Promise<{ error: Error | null; elapsedMs: number }> {
    const fixture = await startFixtureServer({
      workspace,
      oauth: params.oauth,
    });
    const seeded = await seedSource({
      slug: `${params.slug}-${ns}`,
      pullConfig: genieConfig({
        baseUrl: fixture.baseUrl,
        spaceIds: ["space-alpha"],
        startingAt: "2020-01-01T00:00:00.000Z",
        credentials: params.credentials,
      }),
    });
    const startedAt = performance.now();
    let error: Error | null = null;
    try {
      await pullExpectingOutcome({ sourceId: seeded.sourceId, cursor: null });
    } catch (caught) {
      error = caught as Error;
    }
    const elapsedMs = performance.now() - startedAt;
    await fixture.close();
    await dropTenant(seeded.govProjectId);
    await cleanupOrg(seeded.organizationId);
    return { error, elapsedMs };
  }

  /** @scenario "A source with no way to sign in says so" */
  it("fails naming what it needs when given neither a token nor a secret", async () => {
    const { error } = await runWith({ slug: "none", credentials: {} });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/token/i);
    expect(error?.message).toMatch(/client/i);
  }, 120_000);

  /** @scenario "Credentials the workspace rejects fail the run rather than emptying it" */
  it("fails the run when the workspace refuses the credentials", async () => {
    // A refused sign-in that returned no records would look identical to a
    // workspace where nobody asked Genie anything.
    const { error } = await runWith({
      slug: "refused",
      credentials: { clientId: "sp-client-id", clientSecret: "wrong" },
      oauth: { status: 401 },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/sign|token|auth/i);
  }, 120_000);

  /** @scenario "A refused sign-in does not put the secret in the reason" */
  it("does not put the client secret in the reason", async () => {
    const { error } = await runWith({
      slug: "leak",
      credentials: {
        clientId: "sp-client-id",
        clientSecret: "super-secret-value",
      },
      oauth: { status: 401 },
    });
    expect(error).not.toBeNull();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(
      "super-secret-value",
    );
  }, 120_000);

  /** @scenario "A sign-in answered with no token fails the run" */
  it("fails when the sign-in is answered without a token", async () => {
    // A proxy answering 200 with something that is not a token must not be
    // carried forward as one and re-surface later as a permissions problem.
    const { error } = await runWith({
      slug: "notoken",
      credentials: { clientId: "sp-client-id", clientSecret: "sp-secret" },
      oauth: { body: { message: "hello from a captive portal" } },
    });
    expect(error).not.toBeNull();
  }, 120_000);

  /** @scenario "A sign-in that hangs does not consume the whole run" */
  it("abandons a hanging sign-in well before the run's own deadline", async () => {
    // The job has five minutes for everything. A sign-in with no bound of its
    // own would spend all of it and report nothing.
    const { error, elapsedMs } = await runWith({
      slug: "hang",
      credentials: { clientId: "sp-client-id", clientSecret: "sp-secret" },
      oauth: { hang: true },
    });
    expect(error).not.toBeNull();
    expect(elapsedMs).toBeLessThan(60_000);
  }, 180_000);
});

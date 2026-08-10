// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The Genie adapter through the WHOLE chain, with nothing stubbed between the
 * HTTP response and the row a customer's screen reads:
 *
 *   Genie REST (fixture server, or the live workspace) →
 *     ssrfSafeFetch → DatabricksGeniePuller.runOnce →
 *     runIngestionPull → buildPulledUsageRecord →
 *     RecordPulledUsage command on a real EventSourcing runtime →
 *     pulledUsageLedger process manager → its real outbox dispatcher →
 *     insertPulledUsageRows → real ClickHouse →
 *     readPulledUsageTotals + governance_ocsf_events
 *
 * The event-sourcing runtime is real rather than a hand-called intent handler.
 * That matters here: the thing most likely to break a new adapter is not the
 * mapping, it is the command boundary rejecting a record it cannot key, and a
 * test that calls the ledger writer directly would sail straight past it.
 *
 * Most of what is asserted below is about NOT LOSING DATA — pagination that
 * stops early, a watermark that steps over unread history, one forbidden space
 * discarding five good ones. Those failures are silent by construction: the
 * run reports success and the missing records are simply never mentioned
 * again. They only exist as tests.
 *
 * The live tier runs only when `DATABRICKS_GENIE_TOKEN` is set. It is the
 * evidence tier — read-only, against a real workspace — and CI never has the
 * credential, so it skips there rather than failing.
 *
 * Fixture identities are placeholders. Real workspace identities exist only in
 * a live run's own output, never in this file.
 */

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
import { createPulledUsageProcessingPipeline } from "@ee/event-sourcing/pipelines/pulled-usage-processing";
import type { Prisma } from "@prisma/client";
import http from "http";
import { nanoid } from "nanoid";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import { mapCommands } from "~/server/event-sourcing/mapCommands";
import { InMemoryProcessStore } from "~/server/event-sourcing/process-manager/stores/inMemoryProcessStore";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import { ensureHiddenGovernanceProject } from "../../governanceProject.service";
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  DatabricksGeniePuller,
} from "../databricksGenie.puller";
import { type PulledUsageDispatcher, runIngestionPull } from "../pullerWorker";

const ns = `genie-${nanoid(8)}`;

/** The window the pulled read is bounded by. Wide enough for a live pull. */
const WINDOW_FROM = new Date("2020-01-01T00:00:00.000Z");
const WINDOW_TO = new Date("2100-01-01T00:00:00.000Z");

/** Mirrors the adapter's own constant; asserted against, not imported by it. */
const WATERMARK_LAG_MS = 5 * 60 * 1000;

let ch: ClickHouseClient;
let chRepo: GatewayBudgetClickHouseRepository;

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
    processStore: new InMemoryProcessStore(),
    redis: null,
    // Consumers only run for a worker role, and the outbox dispatcher IS the
    // step under test — without this the intent would sit pending forever and
    // the ledger assertions would fail for a reason that has nothing to do
    // with the adapter.
    processRole: "all",
  });
  try {
    const pipeline = eventSourcing.register(
      createPulledUsageProcessingPipeline({
        ledger: { budgetCHRepository: chRepo },
      }),
    );
    const commands = mapCommands(pipeline.commands);
    const pulledUsage: PulledUsageDispatcher = {
      recordPulledUsage: commands.recordPulledUsage,
    };

    const outcome = await runIngestionPull({ ...params, pulledUsage });
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
  sweepStartedAtMs: number | null;
} {
  if (!cursor) throw new Error("expected a cursor");
  return JSON.parse(cursor) as {
    sinceMs: number;
    spaceId: string | null;
    conversationId: string | null;
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
  const govProject = await ensureHiddenGovernanceProject(
    prisma,
    organization.id,
  );
  return {
    organizationId: organization.id,
    teamId: team.id,
    sourceId: source.id,
    govProjectId: govProject.id,
  };
}

async function dropTenant(tenantId: string): Promise<void> {
  for (const table of [
    "governance_ocsf_events",
    "gateway_budget_ledger_events",
  ]) {
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
  installClickHouseTestApp({ resolveClient: async () => ch });
  chRepo = new GatewayBudgetClickHouseRepository(async () => ch);
  // ADR-088 gates the cost record behind this flag, and it is off by default.
  // Without it the pull writes audit rows only and every ledger assertion
  // below would fail for a reason that is not the adapter.
  process.env.FEATURE_FLAG_FORCE_ENABLE = "release_pulled_usage_cost_enabled";
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
}): Promise<{
  baseUrl: string;
  conversationRequests: string[];
  /** Requests per path prefix, for asserting a walk did not spin. */
  requestCounts: Map<string, number>;
  close: () => Promise<void>;
}> {
  const { workspace } = params;
  const conversationRequests: string[] = [];
  const requestCounts = new Map<string, number>();
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

    if (url.pathname === "/api/2.0/genie/spaces") {
      send({
        spaces: Object.entries(SPACE_TITLES).map(([space_id, title]) => ({
          space_id,
          title,
        })),
        next_page_token: null,
      });
      return;
    }

    const conversations =
      /^\/api\/2\.0\/genie\/spaces\/([^/]+)\/conversations$/.exec(url.pathname);
    if (conversations) {
      const spaceId = conversations[1]!;
      params.onBeforeSpace?.(spaceId);
      conversationRequests.push(url.search);

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

    const scim = /^\/api\/2\.0\/preview\/scim\/v2\/Users\/([^/]+)$/.exec(
      url.pathname,
    );
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
    requestCounts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function genieConfig(params: {
  baseUrl: string;
  spaceIds: string[];
  startingAt: string;
}): Prisma.InputJsonObject {
  return {
    adapter: DATABRICKS_GENIE_ADAPTER_ID,
    workspaceUrl: params.baseUrl,
    spaceIds: params.spaceIds,
    startingAt: params.startingAt,
    schedule: "*/15 * * * *",
    credentials: { token: "fixture-token" },
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
      expect(extra.question).toBe(
        "What are the top 5 products by quantity sold?",
      );
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

      expect(withObjectId.actorKey).toBe(
        "11111111-2222-3333-4444-555555555555",
      );
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

    /** @scenario "A question costs nothing and is never priced" */
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
      const reRead = rowsAfterBothSweeps.filter((r) =>
        r.EventId.endsWith("msg-beta-1"),
      );
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
        fixture.requestCounts.get(
          "/api/2.0/genie/spaces/space-loop/conversations",
        ) ?? 0;
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
        fixture.requestCounts.get(
          `/api/2.0/preview/scim/v2/Users/${DELETED_USER_ID}`,
        ) ?? 0;
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
      const adapter = new DatabricksGeniePuller();
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
      const second = await adapter.runOnce(
        { cursor: first.cursor, credentials },
        config,
      );

      const done = decodeCursor(second.cursor);

      // The assertion that bites, and it comes first so that it — rather than
      // the cursor's shape — is what fails if the anchor regresses. Anchored
      // to run ONE, the watermark cannot be later than when run one ended.
      // Anchored to run two, it lands at least the 1.5s gap beyond that, and
      // everything asked in space-alpha during the gap is filtered out for
      // good.
      expect(done.sinceMs).toBeGreaterThanOrEqual(
        beforeFirstRun - WATERMARK_LAG_MS,
      );
      expect(done.sinceMs).toBeLessThanOrEqual(
        afterFirstRun - WATERMARK_LAG_MS,
      );
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
        const adapter = new DatabricksGeniePuller();
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
        expect(firstCursor.sinceMs).toBe(
          Date.parse("2020-01-01T00:00:00.000Z"),
        );

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
        for (const id of [
          "msg-alpha-1",
          "msg-alpha-2",
          "msg-alpha-3",
          "msg-beta-1",
        ]) {
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
        const adapter = new DatabricksGeniePuller();
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
 * A failure and a budget cut in the SAME run.
 *
 * Each on its own was already covered; the loss only exists in their product.
 * A unit that fails in isolation is deliberately walked past, so if the budget
 * then dies further along, a resume marker pointing at where it stopped leaves
 * the failed unit unread for the rest of the sweep — and the sweep that later
 * completes advances the watermark over its messages. The resume point must
 * therefore be the EARLIEST unfinished unit, not the last one touched.
 */
describe("given a unit fails and the budget then runs out later in the same run", () => {
  function fourConversationWorkspace() {
    const alphaMs = Date.UTC(2026, 0, 6, 9, 0, 0);
    const ids = [1, 2, 3, 4];
    const conversations: Record<
      string,
      Array<{
        conversation_id: string;
        title: string;
        created_timestamp: number;
      }>
    > = {
      "space-solo": ids.map((n) => ({
        conversation_id: `conv-s-${n}`,
        title: `Conversation ${n}`,
        created_timestamp: alphaMs,
      })),
    };
    const messages: Record<string, Array<ReturnType<typeof message>>> = {};
    for (const n of ids) {
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

  describe("when the failure came before the conversation it stopped on", () => {
    it("resumes at the failed conversation, not the one it stopped on", async () => {
      const workspace = fourConversationWorkspace();
      const fixture = await startFixtureServer({
        workspace,
        // The second conversation fails in isolation; the third is slow enough
        // to burn the deadline, so the budget dies at the fourth's turn.
        messagesStatus: (conversationId) =>
          conversationId === "conv-s-2" ? 429 : undefined,
        onMessages: async (conversationId) => {
          if (conversationId === "conv-s-3") {
            await new Promise((resolve) => setTimeout(resolve, 1_200));
          }
        },
      });

      try {
        const adapter = new DatabricksGeniePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-solo"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });

        const first = await adapter.runOnce(
          {
            cursor: null,
            credentials: { token: "fixture-token" },
            deadlineMs: Date.now() + 900,
          },
          config,
        );
        const cursor = decodeCursor(first.cursor);

        // The assertion that bites. Resuming at conv-s-4 would step over
        // conv-s-2 for the rest of the sweep, and the watermark would then
        // move past it.
        expect(cursor.conversationId).toBe("conv-s-2");
        expect(cursor.sinceMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));
      } finally {
        await fixture.close();
      }
    }, 60_000);
  });

  describe("when the failed space came before the space it stopped on", () => {
    it("resumes at the failed space, not the one it stopped on", async () => {
      const workspace = createFixtureWorkspace();
      const fixture = await startFixtureServer({
        workspace,
        // space-alpha sorts first and fails in isolation; space-beta is slow
        // enough that the budget dies before space-orphan's turn.
        conversationsStatus: (spaceId) =>
          spaceId === "space-alpha" ? 403 : undefined,
        onMessages: async () => {
          await new Promise((resolve) => setTimeout(resolve, 700));
        },
      });

      try {
        const adapter = new DatabricksGeniePuller();
        const config = adapter.validateConfig({
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          workspaceUrl: fixture.baseUrl,
          spaceIds: ["space-alpha", "space-beta", "space-orphan"],
          startingAt: "2020-01-01T00:00:00.000Z",
          schedule: "*/15 * * * *",
        });

        const first = await adapter.runOnce(
          {
            cursor: null,
            credentials: { token: "fixture-token" },
            deadlineMs: Date.now() + 500,
          },
          config,
        );
        const cursor = decodeCursor(first.cursor);

        // Resuming at space-orphan would leave space-alpha unread for the rest
        // of the sweep, and the completing sweep would move the watermark past
        // everything in it.
        expect(cursor.spaceId).toBe("space-alpha");
        expect(cursor.sinceMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));
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
        const adapter = new DatabricksGeniePuller();
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
        expect(final.sinceMs).toBeGreaterThan(
          Date.parse("2020-01-01T00:00:00.000Z"),
        );
      } finally {
        await fixture.close();
      }
    }, 120_000);
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

describe.skipIf(!liveToken || !liveUrl)(
  "given the live Databricks workspace",
  () => {
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
  },
);

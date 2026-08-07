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
 * The live tier runs only when `DATABRICKS_GENIE_TOKEN` is set. It is the
 * evidence tier — read-only, against a real workspace — and CI never has the
 * credential, so it skips there rather than failing.
 *
 * Fixture identities are placeholders. Real workspace identities exist only in
 * a live run's own output, never in this file.
 */

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
import { DATABRICKS_GENIE_ADAPTER_ID } from "../databricksGenie.puller";
import { type PulledUsageDispatcher, runIngestionPull } from "../pullerWorker";

const ns = `genie-${nanoid(8)}`;

/** The window the pulled read is bounded by. Wide enough for a live pull. */
const WINDOW_FROM = new Date("2020-01-01T00:00:00.000Z");
const WINDOW_TO = new Date("2100-01-01T00:00:00.000Z");

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

/** What the dedicated pulled read reports for a scope. */
function pulledTotalsFor(params: { tenantId: string; scopeIds: string[] }) {
  return chRepo.readPulledUsageTotals({
    tenantId: params.tenantId,
    scopeIds: params.scopeIds,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
}

/** The OCSF audit rows one pull landed, newest last. */
async function ocsfRowsFor(tenantId: string) {
  const result = await ch.query({
    query: `
      SELECT EventId, ActorEmail, ActionName, TargetName, SourceType, RawOcsfJson
      FROM governance_ocsf_events
      WHERE TenantId = {tenantId:String}
      ORDER BY EventTime ASC`,
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

describe("given a Databricks workspace with Genie activity", () => {
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

  const SPACES = [
    { space_id: "space-alpha", title: "ACME Revenue Analyst" },
    { space_id: "space-beta", title: "ACME Trip Analytics" },
  ];

  /** Conversations keyed by space, as the API returns them under include_all. */
  const CONVERSATIONS: Record<string, Array<Record<string, unknown>>> = {
    "space-alpha": [
      {
        conversation_id: "conv-alpha-1",
        title: "What are the top 5 products by quantity sold?",
        created_timestamp: 1_785_935_897_370,
        agent_type: "GENIE_CONVERSATION_TYPE_CHAT",
      },
    ],
    "space-beta": [
      {
        conversation_id: "conv-beta-1",
        title: "Average trip distance by pickup zip",
        created_timestamp: 1_785_481_037_529,
        agent_type: "GENIE_CONVERSATION_TYPE_CHAT",
      },
    ],
  };

  const MESSAGES: Record<string, Array<Record<string, unknown>>> = {
    "conv-alpha-1": [
      {
        message_id: "msg-alpha-1",
        conversation_id: "conv-alpha-1",
        space_id: "space-alpha",
        user_id: 700_000_000_000_001,
        content: "What are the top 5 products by quantity sold?",
        status: "COMPLETED",
        created_timestamp: 1_785_935_897_400,
        attachments: [
          { attachment_id: "att-1", text: { content: "Here are the top 5." } },
          {
            attachment_id: "att-2",
            query: {
              query:
                "SELECT `product`, SUM(`quantity`) AS qty\nFROM `acme`.`sales`.`orders`\nGROUP BY `product`\nORDER BY qty DESC\nLIMIT 5",
              description: "Top products by quantity",
              statement_id: "stmt-alpha-1",
              query_result_metadata: { row_count: 5 },
            },
          },
        ],
      },
    ],
    "conv-beta-1": [
      {
        message_id: "msg-beta-1",
        conversation_id: "conv-beta-1",
        space_id: "space-beta",
        user_id: 700_000_000_000_002,
        content: "What was the average trip distance by pickup zip code?",
        status: "COMPLETED",
        created_timestamp: 1_785_481_037_729,
        attachments: [
          {
            attachment_id: "att-3",
            query: {
              query:
                "SELECT `pickup_zip`, AVG(`trip_distance`) AS avg_distance\nFROM `samples`.`nyctaxi`.`trips`\nGROUP BY `pickup_zip`",
              description: "Average distance by zip",
              statement_id: "stmt-beta-1",
              query_result_metadata: { row_count: 25 },
            },
          },
        ],
      },
    ],
  };

  let server: http.Server;
  let baseUrl: string;
  let seeded: Awaited<ReturnType<typeof seedSource>>;
  /** Every conversations request the adapter made, for the include_all guard. */
  const conversationRequests: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;

      const spaces = /^\/api\/2\.0\/genie\/spaces$/.exec(url.pathname);
      if (spaces) {
        res.end(JSON.stringify({ spaces: SPACES }));
        return;
      }

      const conversations =
        /^\/api\/2\.0\/genie\/spaces\/([^/]+)\/conversations$/.exec(
          url.pathname,
        );
      if (conversations) {
        conversationRequests.push(url.search);
        // The real endpoint answers with the caller's own conversations when
        // include_all is absent. Mirroring that is the whole point of the
        // fixture: an adapter that dropped the flag must fail here, loudly,
        // rather than silently reporting one service account's activity.
        const all = url.searchParams.get("include_all") === "true";
        res.end(
          JSON.stringify({
            conversations: all ? (CONVERSATIONS[conversations[1]!] ?? []) : [],
          }),
        );
        return;
      }

      const messages =
        /^\/api\/2\.0\/genie\/spaces\/[^/]+\/conversations\/([^/]+)\/messages$/.exec(
          url.pathname,
        );
      if (messages) {
        res.end(JSON.stringify({ messages: MESSAGES[messages[1]!] ?? [] }));
        return;
      }

      const scim = /^\/api\/2\.0\/preview\/scim\/v2\/Users\/([^/]+)$/.exec(
        url.pathname,
      );
      if (scim) {
        const user = USERS[scim[1]!];
        if (!user) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        res.end(JSON.stringify(user));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: `unrouted ${url.pathname}` }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    seeded = await seedSource({
      slug: ns,
      pullConfig: {
        adapter: DATABRICKS_GENIE_ADAPTER_ID,
        workspaceUrl: baseUrl,
        spaceIds: [],
        startingAt: "2020-01-01T00:00:00.000Z",
        schedule: "*/15 * * * *",
        credentials: { token: "fixture-token" },
      },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await dropTenant(seeded.govProjectId);
    await cleanupTestRows(prisma, [
      ["ingestionSource", { organizationId: seeded.organizationId }],
      ["project", { team: { organizationId: seeded.organizationId } }],
      ["team", { organizationId: seeded.organizationId }],
      ["organization", { id: seeded.organizationId }],
    ]);
  });

  describe("when the puller sweeps every space", () => {
    it("lands one audit row and one zero-cost visibility record per message", async () => {
      const outcome = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: null,
      });

      expect(outcome.eventCount).toBe(2);

      const rows = await ocsfRowsFor(seeded.govProjectId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.EventId).sort()).toEqual([
        `databricks_genie:${seeded.sourceId}:msg-alpha-1`,
        `databricks_genie:${seeded.sourceId}:msg-beta-1`,
      ]);

      // The two artefacts this adapter exists to surface.
      const alpha = rows.find((r) => r.EventId.endsWith("msg-alpha-1"))!;
      const alphaExtra = extensionOf(alpha);
      expect(alpha.ActorEmail).toBe("dana.hoffman@acme.test");
      expect(alpha.TargetName).toBe("ACME Revenue Analyst");
      expect(alpha.ActionName).toBe("genie_query");
      expect(alphaExtra.question).toBe(
        "What are the top 5 products by quantity sold?",
      );
      expect(alphaExtra.generatedSql).toContain("`acme`.`sales`.`orders`");
      expect(alphaExtra.statementId).toBe("stmt-alpha-1");
      expect(alphaExtra.rowCount).toBe(5);

      // The money side: the record exists, and it carries nothing.
      const totals = await pulledTotalsFor({
        tenantId: seeded.govProjectId,
        scopeIds: [seeded.teamId, seeded.organizationId],
      });
      expect(totals.items).toBe(2);
      expect(totals.spentNanoUsd).toBe(0);
      expect(totals.spentUsd).toBe("0");
    });

    it("asks for every user's conversations, not just the caller's", async () => {
      // The failure this guards is silent: without include_all the sweep
      // returns the service account's own conversations, reports success, and
      // under-reports the workspace forever with nothing looking wrong.
      expect(conversationRequests.length).toBeGreaterThan(0);
      for (const search of conversationRequests) {
        expect(search).toContain("include_all=true");
      }
    });

    it("keys identity on the IdP object id, and falls back to the login without one", async () => {
      const rows = await ocsfRowsFor(seeded.govProjectId);
      const withExternalId = extensionOf(
        rows.find((r) => r.EventId.endsWith("msg-alpha-1"))!,
      );
      const withoutExternalId = extensionOf(
        rows.find((r) => r.EventId.endsWith("msg-beta-1"))!,
      );

      expect(withExternalId.actorKey).toBe(
        "11111111-2222-3333-4444-555555555555",
      );
      expect(withExternalId.actorEmail).toBe("dana.hoffman@acme.test");

      // No object id in the directory, so the login carries the identity.
      expect(withoutExternalId.actorExternalId).toBe("");
      expect(withoutExternalId.actorKey).toBe("priya.nair@acme.test");
    });

    it("advances its watermark so a second sweep re-reads nothing", async () => {
      const first = JSON.parse(
        (
          await pullThroughTheRealPipeline({
            sourceId: seeded.sourceId,
            cursor: null,
          })
        ).nextCursor!,
      ) as { sinceMs: number; spaceId: string | null };
      // The newest fixture message. A complete sweep moves the watermark to it
      // and leaves no resume position behind.
      expect(first.sinceMs).toBe(1_785_935_897_400);
      expect(first.spaceId).toBeNull();

      const second = await pullThroughTheRealPipeline({
        sourceId: seeded.sourceId,
        cursor: JSON.stringify(first),
      });
      expect(second.eventCount).toBe(0);
    });
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
      await cleanupTestRows(prisma, [
        ["ingestionSource", { organizationId: seeded.organizationId }],
        ["project", { team: { organizationId: seeded.organizationId } }],
        ["team", { organizationId: seeded.organizationId }],
        ["organization", { id: seeded.organizationId }],
      ]);
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

        const perSpace = new Map<string, number>();
        for (const row of rows) {
          const title = String(extensionOf(row).spaceTitle);
          perSpace.set(title, (perSpace.get(title) ?? 0) + 1);
        }
        console.log(
          `[genie-live] ${rows.length} records across ${perSpace.size} spaces:`,
          Object.fromEntries(perSpace),
        );
        const sample = extensionOf(rows[0]!);
        console.log("[genie-live] sample record:", {
          actorKey: sample.actorKey,
          actorEmail: sample.actorEmail,
          space: sample.spaceTitle,
          question: sample.question,
          sql: String(sample.generatedSql).slice(0, 160),
          costNanoUsd: 0,
        });
      });
    });
  },
);

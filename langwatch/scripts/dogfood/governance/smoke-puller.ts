/**
 * PullerAdapter framework smoke evidence script.
 *
 * Drives the universal puller framework end-to-end against a local
 * fixture HTTP server, with no external compliance API required:
 *
 *   1. Spin up a local http.createServer that returns a paginated
 *      audit-log feed (page 1 → page 2 → drained).
 *   2. Create a fresh org + team + IngestionSource with `pullConfig`
 *      pointing at the fixture server and `adapter: "http_polling"`.
 *   3. Invoke `runIngestionPullForSource` directly — same code path the
 *      event-sourcing pull scheduler hits per scheduled tick.
 *   4. Read `governance_ocsf_events` from ClickHouse and print one
 *      OCSF row per event for visual confirmation.
 *   5. Print PG IngestionSource state (cursor + status) so the admin
 *      surface "last event 2s ago" / "active" claim is grounded.
 *
 * Usage (host-side, app container running):
 *   docker exec wise-mixing-zebra-app-1 sh -c \
 *     'cd /app && pnpm tsx scripts/dogfood/governance/smoke-puller.ts'
 *
 * Exit code: 0 = OCSF rows landed + cursor drained; 1 = anything else.
 */

import { createClient } from "@clickhouse/client";
import { randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { ensureHiddenGovernanceProject } from "../../../ee/governance/services/governanceProject.service";
import { runIngestionPullForSource } from "../../../ee/governance/services/pullers/pullerWorker";
import { prisma } from "../../../src/server/db";

const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_URL ??
  "http://default:langwatch@localhost:8123/langwatch";

function rid(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

const fixturePage1 = {
  events: [
    {
      id: "smoke-evt-001",
      created_at: new Date(Date.now() - 60_000).toISOString(),
      user: { email: "alice@acme.test" },
      event_type: "completion",
      model: "claude-sonnet-4-6",
      usage: { cost: 0.012, input_tokens: 120, output_tokens: 60 },
    },
    {
      id: "smoke-evt-002",
      created_at: new Date(Date.now() - 30_000).toISOString(),
      user: { email: "bob@acme.test" },
      event_type: "completion",
      model: "claude-sonnet-4-6",
      usage: { cost: 0.018, input_tokens: 200, output_tokens: 80 },
    },
  ],
  next_cursor: "page-2",
};
const fixturePage2 = {
  events: [
    {
      id: "smoke-evt-003",
      created_at: new Date().toISOString(),
      user: { email: "alice@acme.test" },
      event_type: "completion",
      model: "claude-sonnet-4-6",
      usage: { cost: 0.005, input_tokens: 50, output_tokens: 20 },
    },
  ],
  next_cursor: null,
};

async function startFixtureServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const cursor = url.searchParams.get("cursor");
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify(cursor === "page-2" ? fixturePage2 : fixturePage1));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/audit-log`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  const slug = `puller-smoke-${Date.now()}`;
  console.log(`[smoke-puller] starting; namespace=${slug}`);

  const { url: fixtureUrl, close: closeFixture } = await startFixtureServer();
  console.log(`[smoke-puller] fixture HTTP server: ${fixtureUrl}`);

  const org = await prisma.organization.create({
    data: { id: rid("org_smk"), name: "ACME Puller Smoke", slug },
  });
  const team = await prisma.team.create({
    data: {
      id: rid("team_smk"),
      name: "Puller Smoke Team",
      slug: `${slug}-team`,
      organizationId: org.id,
    },
  });
  const source = await prisma.ingestionSource.create({
    data: {
      organizationId: org.id,
      teamId: team.id,
      sourceType: "claude_compliance",
      name: `puller-smoke-${slug}`,
      ingestSecretHash: rid("hash"),
      status: "awaiting_first_event",
      pullSchedule: "*/15 * * * *",
      parserConfig: {
        adapter: "http_polling",
        url: fixtureUrl,
        method: "GET",
        headers: { Accept: "application/json" },
        authMode: "header_template",
        cursorJsonPath: "$.next_cursor",
        cursorQueryParam: "cursor",
        eventsJsonPath: "$.events",
        schedule: "*/15 * * * *",
        eventMapping: {
          source_event_id: "$.id",
          event_timestamp: "$.created_at",
          actor: "$.user.email",
          action: "$.event_type",
          target: "$.model",
          cost_usd: "$.usage.cost",
          tokens_input: "$.usage.input_tokens",
          tokens_output: "$.usage.output_tokens",
        },
      },
    },
  });
  console.log(`[smoke-puller] IngestionSource minted: id=${source.id}`);

  await runIngestionPullForSource({ ingestionSourceId: source.id });
  console.log(`[smoke-puller] runIngestionPullForSource completed`);

  const govProject = await ensureHiddenGovernanceProject(prisma, org.id);
  console.log(`[smoke-puller] hidden Governance Project: id=${govProject.id}`);

  // Async insert settle.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const ch = createClient({ url: CLICKHOUSE_URL });
  try {
    const result = await ch.query({
      query: `
        SELECT
          EventId,
          ActorEmail,
          ActionName,
          TargetName,
          SourceType,
          TenantId,
          TraceId,
          toString(EventTime) AS EventTimeIso
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
        ORDER BY EventTime ASC
      `,
      query_params: { tenantId: govProject.id },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<Record<string, string>>;
    console.log(
      `[smoke-puller] CH governance_ocsf_events rows for tenant=${govProject.id}: ${rows.length}`,
    );
    for (const row of rows) {
      console.log(
        `  - ${row.EventId} | actor=${row.ActorEmail} | model=${row.TargetName} | trace=${row.TraceId}`,
      );
    }

    const updated = await prisma.ingestionSource.findUnique({
      where: { id: source.id },
    });
    console.log(
      `[smoke-puller] PG IngestionSource: status=${updated?.status} cursor=${JSON.stringify(updated?.pollerCursor)} lastEventAt=${updated?.lastEventAt?.toISOString() ?? "null"} errorCount=${updated?.errorCount}`,
    );

    const ok =
      rows.length === 3 &&
      updated?.status === "active" &&
      updated?.pollerCursor === null &&
      updated?.errorCount === 0;
    if (!ok) {
      console.error("[smoke-puller] FAIL — see output above");
      process.exit(1);
    }
    console.log(
      `[smoke-puller] OK — ${rows.length} OCSF rows + cursor drained + status active`,
    );
  } finally {
    await ch.close();
    await closeFixture();
  }
}

main()
  .catch((error) => {
    console.error("[smoke-puller] ERROR", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

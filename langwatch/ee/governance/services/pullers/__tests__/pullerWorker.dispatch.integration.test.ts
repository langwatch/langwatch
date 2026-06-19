// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";
/**
 * @vitest-environment node
 *
 * End-to-end integration coverage for the PullerAdapter framework. Exercises
 * the FULL chain with no mocks at the storage edges:
 *
 *   real fixture HTTP server (http.createServer) →
 *     ssrfSafeFetch (real undici via SSRF wrapper) →
 *     HttpPollingPullerAdapter.runOnce (real adapter, real pagination) →
 *     mapToOcsfRow (real composition) →
 *     GovernanceOcsfEventsClickHouseRepository.insertEvent (real CH client) →
 *     governance_ocsf_events row in real ClickHouse →
 *     PG IngestionSource cursor + status update (real Prisma)
 *
 * The unit tier (`pullerWorker.dispatch.unit.test.ts`) covers the dispatch
 * branches with mocked storage; this tier proves the framework actually
 * round-trips an event into ClickHouse using the same TenantId the SIEM
 * export service reads from.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import http from "http";
import { nanoid } from "nanoid";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ensureHiddenGovernanceProject } from "../../governanceProject.service";
import { runIngestionPullForSource } from "../pullerWorker";

const ns = `puller-e2e-${nanoid(8)}`;

let organizationId: string;
let teamId: string;
let govProjectId: string;
let ingestionSourceId: string;
let ch: ClickHouseClient;
let server: http.Server;
let serverUrl: string;

// Fixture audit-log response — page 1 returns 2 events + a next_cursor;
// page 2 returns 1 event + null cursor (drained). Mirrors the real
// shape of Anthropic / Microsoft compliance APIs.
const fixturePage1 = {
  events: [
    {
      id: "evt-001",
      created_at: "2026-05-01T10:00:00.000Z",
      user: { email: "alice@acme.test" },
      event_type: "completion",
      model: "claude-sonnet-4-6",
      usage: { cost: 0.012, input_tokens: 120, output_tokens: 60 },
    },
    {
      id: "evt-002",
      created_at: "2026-05-01T10:05:00.000Z",
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
      id: "evt-003",
      created_at: "2026-05-01T10:10:00.000Z",
      user: { email: "alice@acme.test" },
      event_type: "completion",
      model: "claude-sonnet-4-6",
      usage: { cost: 0.005, input_tokens: 50, output_tokens: 20 },
    },
  ],
  next_cursor: null,
};

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) {
    throw new Error("Test ClickHouse client not initialised");
  }
  ch = client;

  // Spin up a local fixture HTTP server. ssrfSafeFetch allows localhost
  // when IS_SAAS is unset (on-prem dev mode), which is the integration
  // suite's default.
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const cursor = url.searchParams.get("cursor");
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify(cursor === "page-2" ? fixturePage2 : fixturePage1));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  serverUrl = `http://127.0.0.1:${port}/audit-log`;

  // PG seed: org → team → IngestionSource (governance project minted
  // lazily by the worker — same code path the production worker hits).
  const organization = await prisma.organization.create({
    data: { name: `Puller E2E Org ${ns}`, slug: `--puller-e2e-${ns}` },
  });
  organizationId = organization.id;

  const team = await prisma.team.create({
    data: {
      name: `Puller E2E Team ${ns}`,
      slug: `--puller-e2e-team-${ns}`,
      organizationId,
    },
  });
  teamId = team.id;

  const source = await prisma.ingestionSource.create({
    data: {
      organizationId,
      teamId,
      sourceType: "claude_compliance",
      name: `puller-e2e-source-${ns}`,
      ingestSecretHash: `hash-${ns}`,
      status: "awaiting_first_event",
      pullSchedule: "*/15 * * * *",
      parserConfig: {
        adapter: "http_polling",
        url: serverUrl,
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
  ingestionSourceId = source.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (govProjectId) {
    await ch
      .command({
        query: `DELETE FROM governance_ocsf_events WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: govProjectId },
      })
      .catch(() => {});
  }
  await prisma.ingestionSource
    .deleteMany({ where: { organizationId } })
    .catch(() => {});
  await prisma.project
    .deleteMany({ where: { team: { organizationId } } })
    .catch(() => {});
  await prisma.team.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.organization
    .deleteMany({ where: { id: organizationId } })
    .catch(() => {});
});

describe("PullerAdapter framework — end-to-end with real CH + real fetch", () => {
  /** @scenario "A due pull runs the existing pull body and writes OCSF events" */
  it("fetches a paginated audit-log feed and lands one OCSF row per event", async () => {
    await runIngestionPullForSource({ ingestionSourceId });

    const govProject = await ensureHiddenGovernanceProject(
      prisma,
      organizationId,
    );
    govProjectId = govProject.id;

    // async_insert + wait_for_async_insert=0 means the row may take
    // a moment to settle. Mirror the OCSF integration tests' pattern.
    await new Promise((resolve) => setTimeout(resolve, 700));

    const result = await ch.query({
      query: `
        SELECT
          EventId,
          ActorEmail,
          ActionName,
          TargetName,
          SourceType,
          TenantId,
          TraceId
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
        ORDER BY EventTime ASC
      `,
      query_params: { tenantId: govProjectId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      EventId: string;
      ActorEmail: string;
      ActionName: string;
      TargetName: string;
      SourceType: string;
      TenantId: string;
      TraceId: string;
    }>;

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.EventId)).toEqual([
      "claude_compliance:evt-001",
      "claude_compliance:evt-002",
      "claude_compliance:evt-003",
    ]);
    expect(rows[0]).toMatchObject({
      ActorEmail: "alice@acme.test",
      ActionName: "completion",
      TargetName: "claude-sonnet-4-6",
      SourceType: "claude_compliance",
      TenantId: govProjectId,
      TraceId: "pull:claude_compliance:evt-001",
    });

    // PG side: cursor drained (null), status promoted to active,
    // lastEventAt stamped.
    const updated = await prisma.ingestionSource.findUnique({
      where: { id: ingestionSourceId },
    });
    expect(updated?.pollerCursor).toBeNull();
    expect(updated?.status).toBe("active");
    expect(updated?.lastEventAt).toBeInstanceOf(Date);
    expect(updated?.errorCount).toBe(0);
  });
});

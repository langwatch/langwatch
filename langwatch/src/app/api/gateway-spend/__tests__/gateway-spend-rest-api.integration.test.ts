/**
 * Integration tests for the billing reconciliation REST surface against real
 * Postgres and ClickHouse: cursor-stable pagination, org fencing, end-user
 * rollups, replay semantics, and the auth + plan gates.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  GatewaySpendEventsRepository,
  type SpendEventRow,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import { KSUID_RESOURCES } from "~/utils/constants";

// The enterprise gate reads the org's active plan through the app layer;
// tests flip this flag per scenario instead of booting the whole app.
let planHasWebhookEndpoints = true;
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: {
      getActivePlan: async () => ({
        webhookEndpointsEnabled: planHasWebhookEndpoints,
      }),
    },
  }),
}));

// Route both apps' ClickHouse resolution at the test cluster.
let chClient: ClickHouseClient;
vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/clickhouse/clickhouseClient")
    >();
  return {
    ...original,
    getClickHouseClientForProject: async () => chClient,
  };
});

import { app } from "../[[...route]]/app";

const ns = `billing-api-${nanoid(8)}`;
const baseTime = Date.UTC(2026, 0, 10, 12, 0, 0);

describe("Feature: Gateway spend reconciliation REST surface", () => {
  let organization: Organization;
  let foreignOrganization: Organization;
  let project: Project;
  let foreignProject: Project;
  let apiKeyToken: string;
  let userId: string;
  let repo: GatewaySpendEventsRepository;

  const headers = () => ({
    Authorization: `Bearer ${apiKeyToken}`,
    "Content-Type": "application/json",
  });

  const spendRow = (
    requestId: string,
    overrides: Partial<SpendEventRow> = {},
  ): SpendEventRow => ({
    tenantId: project.id,
    gatewayRequestId: requestId,
    organizationId: organization.id,
    teamId: "team-x",
    virtualKeyId: "vk-1",
    principalUserId: "",
    endUserId: "",
    traceId: `trace-${requestId}`,
    model: "openai/gpt-5",
    providerKey: "prov-1",
    tokensInput: 100,
    tokensOutput: 50,
    tokensCacheRead: 10,
    tokensCacheWrite: 5,
    tokensReasoning: 0,
    costUsd: "0.010000",
    costNanoUsd: 10_000_000,
    rateVersion: "catalog@2026-07-26",
    status: "confirmed" as const,
    errorClass: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    requestType: "chat",
    labels: [],
    metadata: "",
    durationMs: 800,
    occurredAt: new Date(baseTime),
    ...overrides,
  });

  // The write path is the fold's upsert now; tests seed by mapping a row to
  // the fold state it would have produced. Write stamps are strictly
  // monotonic: the walk pages by (EventTimestamp, GatewayRequestId), and two
  // seeds landing in the same millisecond would tie, letting the id
  // tiebreak place a later insert behind an already-served cursor.
  let seedClock = Date.now();
  async function seed(rows: SpendEventRow[]): Promise<void> {
    await repo.upsertFromFold(
      rows.map((row) => ({
        tenantId: row.tenantId,
        gatewayRequestId: row.gatewayRequestId,
        state: {
          status: row.status,
          organizationId: row.organizationId,
          virtualKeyId: row.virtualKeyId,
          principalUserId: row.principalUserId,
          endUserId: row.endUserId,
          model: row.model,
          providerKey: row.providerKey,
          traceId: row.traceId,
          requestType: row.requestType,
          labels: row.labels,
          metadataJson: row.metadata,
          podId: "",
          podSeq: 0,
          usage: {
            input_tokens: row.tokensInput,
            output_tokens: row.tokensOutput,
            cache_read_input_tokens: row.tokensCacheRead,
            cache_creation_input_tokens: row.tokensCacheWrite,
            reasoning_tokens: row.tokensReasoning,
          },
          rateVersion: row.rateVersion,
          // Overrides set the display string; derive the integer so both
          // stay consistent however the row was authored.
          costNanoUsd: Math.round(Number(row.costUsd) * 1_000_000_000),
          errorType: row.errorClass,
          httpStatus: row.httpStatus,
          needsReconciliation: row.needsReconciliation,
          settleReason: row.settleReason,
          occurredAtMs: row.occurredAt.getTime(),
          durationMs: row.durationMs,
          // Write-time stamps: the walk pages by insert order, so the
          // version must be the seed instant, never the occurred-at.
          createdAt: ++seedClock,
          updatedAt: ++seedClock,
          LastEventOccurredAt: row.occurredAt.getTime(),
        },
      })),
    );
  }

  beforeAll(async () => {
    const containers = await startTestContainers();
    chClient = containers.clickHouseClient;
    repo = new GatewaySpendEventsRepository(async () => chClient);

    organization = await prisma.organization.create({
      data: { name: "Billing API Org", slug: `--test-org-${ns}` },
    });
    foreignOrganization = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `--test-foreign-${ns}` },
    });
    const team = await prisma.team.create({
      data: {
        name: "Billing Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    const foreignTeam = await prisma.team.create({
      data: {
        name: "Foreign Team",
        slug: `--test-fteam-${ns}`,
        organizationId: foreignOrganization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Billing Project",
        slug: `--test-project-${ns}`,
        teamId: team.id,
        language: "other",
        framework: "other",
        apiKey: `test-key-${ns}`,
      },
    });
    foreignProject = await prisma.project.create({
      data: {
        name: "Foreign Project",
        slug: `--test-fproject-${ns}`,
        teamId: foreignTeam.id,
        language: "other",
        framework: "other",
        apiKey: `test-fkey-${ns}`,
      },
    });
    const user = await prisma.user.create({
      data: { name: "Billing Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: organization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
    });
    const apiKeyService = ApiKeyService.create(prisma);
    const created = await apiKeyService.create({
      name: `billing-key-${nanoid(6)}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    });
    apiKeyToken = created.token;
  }, 120_000);

  afterAll(async () => {
    // A failed beforeAll leaves the fixtures unset; surfacing the original
    // failure beats a TypeError from teardown.
    if (!organization?.id) return;
    if (chClient) {
      for (const tenant of [project?.id, foreignProject?.id]) {
        if (!tenant) continue;
        await chClient.command({
          query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenant}'`,
        });
      }
    }
    for (const org of [organization, foreignOrganization]) {
      if (!org) continue;
      await prisma.roleBinding.deleteMany({
        where: { organizationId: org.id },
      });
      await prisma.apiKey.deleteMany({ where: { organizationId: org.id } });
      await prisma.organizationUser.deleteMany({
        where: { organizationId: org.id },
      });
    }
    await prisma.project.deleteMany({
      where: { id: { in: [project?.id ?? "", foreignProject?.id ?? ""] } },
    });
    await prisma.team.deleteMany({
      where: {
        organizationId: {
          in: [organization?.id ?? "", foreignOrganization?.id ?? ""],
        },
      },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.deleteMany({
      where: {
        id: { in: [organization?.id ?? "", foreignOrganization?.id ?? ""] },
      },
    });
    await stopTestContainers();
  });

  /** @scenario Requests without an org API key are unauthorized */
  it("returns 401 without an api key", async () => {
    const res = await app.request("/api/gateway/v1/spend-events");
    expect(res.status).toBe(401);
  });

  /** @scenario Without the plan flag the surface refuses politely */
  it("refuses without the enterprise plan flag", async () => {
    planHasWebhookEndpoints = false;
    try {
      const res = await app.request("/api/gateway/v1/spend-events", {
        headers: headers(),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("enterprise");
    } finally {
      planHasWebhookEndpoints = true;
    }
  });

  /** @scenario Pagination under concurrent inserts never skips a row */
  it("serves late-folded rows on later pages of an in-flight walk", async () => {
    await seed([
      spendRow(`${ns}-r1`, { occurredAt: new Date(baseTime + 1_000) }),
      spendRow(`${ns}-r2`, { occurredAt: new Date(baseTime + 2_000) }),
    ]);
    await seed([
      spendRow(`${ns}-r3`, { occurredAt: new Date(baseTime + 3_000) }),
    ]);

    const page1Res = await app.request(
      `/api/gateway/v1/spend-events?limit=2&from=${baseTime - 120_000}&to=${baseTime + 600_000}`,
      { headers: headers() },
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as {
      data: Array<{ id: string }>;
      next_cursor: string | null;
    };
    expect(page1.data).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();

    // A late fold: OLDER occurred-at than everything served, inserted while
    // the walk is mid-flight. Insert-order pagination must still serve it.
    await seed([
      spendRow(`${ns}-late`, { occurredAt: new Date(baseTime - 60_000) }),
    ]);

    const seen: string[] = page1.data.map((e) => e.id);
    let cursor = page1.next_cursor;
    while (cursor !== null) {
      const res = await app.request(
        `/api/gateway/v1/spend-events?limit=2&from=${baseTime - 120_000}&to=${baseTime + 600_000}&cursor=${encodeURIComponent(cursor)}`,
        { headers: headers() },
      );
      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        data: Array<{ id: string }>;
        next_cursor: string | null;
      };
      seen.push(...page.data.map((e) => e.id));
      cursor = page.next_cursor;
    }

    // Envelope ids are type-suffixed; the raw request id rides in
    // data.gateway_request_id as the join key.
    expect(seen).toContain(`${ns}-late:completed`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  /** @scenario The pull is org-fenced */
  it("never serves another organization's rows", async () => {
    await seed([
      {
        ...spendRow(`${ns}-foreign`),
        tenantId: foreignProject.id,
        organizationId: foreignOrganization.id,
      },
    ]);
    const res = await app.request(
      `/api/gateway/v1/spend-events?limit=200&from=${baseTime - 120_000}&to=${baseTime + 600_000}`,
      {
        headers: headers(),
      },
    );
    // Envelope ids are type-suffixed, so the fence must assert on the raw
    // join key or it can never fail.
    const body = (await res.json()) as {
      data: Array<{ data: { gateway_request_id: string } }>;
    };
    expect(body.data.map((e) => e.data.gateway_request_id)).not.toContain(
      `${ns}-foreign`,
    );
  });

  it("refuses an inverted time range", async () => {
    const res = await app.request(
      `/api/gateway/v1/spend-events?from=${baseTime + 10_000}&to=${baseTime}`,
      { headers: headers() },
    );
    expect(res.status).toBe(422);
  });

  /** @scenario A garbled cursor is refused, not silently reset */
  it("rejects an undecodable cursor with 400", async () => {
    const res = await app.request(
      `/api/gateway/v1/spend-events?cursor=%25garbage%25&from=${baseTime - 120_000}&to=${baseTime + 600_000}`,
      { headers: headers() },
    );
    expect(res.status).toBe(400);
  });

  /** @scenario Per key summaries roll up priced outcomes with settled counted separately */
  it("summarizes by end user with settled counted apart from cost", async () => {
    const u = `${ns}-sum-user`;
    await seed([
      spendRow(`${ns}-sum-1`, {
        endUserId: u,
        costUsd: "0.020000",
        occurredAt: new Date(baseTime + 40_000),
      }),
      spendRow(`${ns}-sum-2`, {
        endUserId: u,
        costUsd: "0.030000",
        occurredAt: new Date(baseTime + 41_000),
      }),
      // Nonzero on purpose: if the aggregation ever sums settled rows,
      // the cost and token assertions below must fail, not coast on zero.
      spendRow(`${ns}-sum-settled`, {
        endUserId: u,
        status: "settled" as const,
        needsReconciliation: true,
        settleReason: "confirmation_deadline_expired",
        costUsd: "0.099000",
        tokensInput: 7_777,
        tokensOutput: 8_888,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        occurredAt: new Date(baseTime + 42_000),
      }),
    ]);

    const res = await app.request(
      `/api/gateway/v1/spend-summaries?group_by=end_user&from=${baseTime + 39_000}&to=${baseTime + 50_000}`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        key: string;
        event_count: number;
        settled_count: number;
        usage: { input_tokens: number };
        cost: { total_usd: string; nano_usd: number };
      }>;
    };
    const row = body.data.find((r) => r.key === u)!;
    expect(row).toBeDefined();
    expect(row.event_count).toBe(2);
    expect(row.settled_count).toBe(1);
    expect(row.cost.nano_usd).toBe(50_000_000);
    expect(Number(row.cost.total_usd)).toBeCloseTo(0.05, 6);
    expect(row.usage.input_tokens).toBe(200);
  });

  /** @scenario The end-user rollup sums exactly that user's requests in the window */
  it("rolls up one end user's spend with token classes", async () => {
    await seed([
      spendRow(`${ns}-u1a`, {
        endUserId: `${ns}-user-1`,
        costUsd: "0.020000",
        occurredAt: new Date(baseTime + 10_000),
      }),
      spendRow(`${ns}-u1b`, {
        endUserId: `${ns}-user-1`,
        costUsd: "0.030000",
        occurredAt: new Date(baseTime + 11_000),
      }),
      spendRow(`${ns}-u2`, {
        endUserId: `${ns}-user-2`,
        costUsd: "5.000000",
        occurredAt: new Date(baseTime + 12_000),
      }),
    ]);
    const res = await app.request(
      `/api/gateway/v1/end-users/${ns}-user-1/spend?from=${baseTime}&to=${baseTime + 60_000}`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        cost: { total_usd: string };
        request_count: number;
        usage: { input_tokens: number };
        cap: null;
      };
    };
    expect(Number(body.data.cost.total_usd)).toBeCloseTo(0.05, 6);
    expect(body.data.request_count).toBe(2);
    expect(body.data.usage.input_tokens).toBe(200);
    expect(body.data.cap).toBeNull();
  });

  /** @scenario A virtual key filter narrows the rollup */
  it("narrows the rollup to one virtual key", async () => {
    await seed([
      spendRow(`${ns}-vk-a`, {
        endUserId: `${ns}-user-3`,
        virtualKeyId: "vk-a",
        costUsd: "0.010000",
        occurredAt: new Date(baseTime + 20_000),
      }),
      spendRow(`${ns}-vk-b`, {
        endUserId: `${ns}-user-3`,
        virtualKeyId: "vk-b",
        costUsd: "0.040000",
        occurredAt: new Date(baseTime + 21_000),
      }),
    ]);
    const res = await app.request(
      `/api/gateway/v1/end-users/${ns}-user-3/spend?from=${baseTime}&to=${baseTime + 60_000}&virtual_key_id=vk-a`,
      { headers: headers() },
    );
    const body = (await res.json()) as {
      data: { cost: { total_usd: string }; request_count: number };
    };
    expect(Number(body.data.cost.total_usd)).toBeCloseTo(0.01, 6);
    expect(body.data.request_count).toBe(1);
  });
});

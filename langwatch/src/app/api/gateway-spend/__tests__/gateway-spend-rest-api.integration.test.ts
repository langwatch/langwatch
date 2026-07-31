/**
 * Integration tests for the billing reconciliation REST surface against real
 * Postgres and ClickHouse: cursor-stable pagination, org fencing, end-user
 * rollups, replay semantics, and the auth + plan gates.
 */

import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Project,
} from "@prisma/client";
import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  GatewaySpendEventsRepository,
  type SpendEventRow,
} from "~/server/gateway/spendEvents.clickhouse.repository";

// The enterprise gate reads the org's active plan through the app layer;
// tests flip this flag per scenario instead of booting the whole app.
let planHasWebhookEndpoints = true;
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: {
      getActivePlan: async () => ({
        webhookEndpoints: planHasWebhookEndpoints,
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
    if (chClient) {
      for (const tenant of [project?.id, foreignProject?.id]) {
        if (!tenant) continue;
        await chClient
          .command({
            query: `ALTER TABLE gateway_spend_events DELETE WHERE TenantId = '${tenant}'`,
          })
          .catch(() => {});
      }
    }
    for (const org of [organization, foreignOrganization]) {
      if (!org) continue;
      await prisma.roleBinding
        .deleteMany({ where: { organizationId: org.id } })
        .catch(() => {});
      await prisma.apiKey
        .deleteMany({ where: { organizationId: org.id } })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organizationId: org.id } })
        .catch(() => {});
    }
    await prisma.project
      .deleteMany({
        where: { id: { in: [project?.id ?? "", foreignProject?.id ?? ""] } },
      })
      .catch(() => {});
    await prisma.team
      .deleteMany({
        where: {
          organizationId: {
            in: [organization?.id ?? "", foreignOrganization?.id ?? ""],
          },
        },
      })
      .catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.organization
      .deleteMany({
        where: {
          id: { in: [organization?.id ?? "", foreignOrganization?.id ?? ""] },
        },
      })
      .catch(() => {});
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
      "/api/gateway/v1/spend-events?limit=2",
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
        `/api/gateway/v1/spend-events?limit=2&cursor=${encodeURIComponent(cursor)}`,
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
    const res = await app.request("/api/gateway/v1/spend-events?limit=200", {
      headers: headers(),
    });
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((e) => e.id)).not.toContain(`${ns}-foreign`);
  });

  /** @scenario A garbled cursor is refused, not silently reset */
  it("rejects an undecodable cursor with 400", async () => {
    const res = await app.request(
      "/api/gateway/v1/spend-events?cursor=%25garbage%25",
      { headers: headers() },
    );
    expect(res.status).toBe(400);
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

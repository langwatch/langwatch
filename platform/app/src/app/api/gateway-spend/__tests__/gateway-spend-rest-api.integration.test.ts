/**
 * Integration tests for the billing reconciliation REST surface against real
 * Postgres and ClickHouse: cursor-stable pagination, org fencing, end-user
 * rollups, replay semantics, and the auth + plan gates.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
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
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import {
  GatewaySpendEventsRepository,
  type SpendEventRow,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { expectCanonicalError } from "~/test-utils/expectCanonicalError";
import { KSUID_RESOURCES } from "~/utils/constants";

// Both apps' ClickHouse resolution routes at the test cluster; the repos
// below are real instances (not fakes) so a `vi.spyOn` against their
// prototypes still intercepts calls the route makes through `getApp()`.
let chClient: ClickHouseClient;
const resolveTestClickHouseClient = async () => chClient;

// The enterprise gate reads the org's active plan through the app layer;
// tests flip this flag per scenario instead of booting the whole app. The
// route takes its ClickHouse-backed repositories from `getApp().gateway`
// too, so standing in for the store means standing in for all of it.
let planHasWebhookEndpoints = true;
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: {
      getActivePlan: async () => ({
        webhookEndpointsEnabled: planHasWebhookEndpoints,
      }),
    },
    gateway: {
      budgets: new GatewayBudgetClickHouseRepository(
        resolveTestClickHouseClient,
      ),
      virtualKeySpend: undefined,
      spendEvents: new GatewaySpendEventsRepository(
        resolveTestClickHouseClient,
      ),
      webhookEvents: new WebhookEventsClickHouseRepository(
        resolveTestClickHouseClient,
      ),
    },
  }),
}));

vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/clickhouse/clickhouseClient")
    >();
  return {
    ...original,
    getClickHouseClientForProject: resolveTestClickHouseClient,
  };
});

import { holdClickHouseSchemaLockForFile } from "~/server/clickhouse/__tests__/holdSchemaLock";
import { app } from "../[[...route]]/app";

const ns = `billing-api-${nanoid(8)}`;
const baseTime = Date.UTC(2026, 0, 10, 12, 0, 0);

/**
 * Spend rows are tenant-namespaced in ClickHouse, so teardown deletes per
 * tenant. A tenant id is absent when its fixture never got created, and the
 * client itself is unset when the containers never came up.
 */
async function dropSpendRowsForTenants(
  tenantIds: Array<string | undefined>,
): Promise<void> {
  if (!chClient) return;
  for (const tenantId of tenantIds) {
    if (!tenantId) continue;
    await chClient.command({
      query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenantId}'`,
    });
  }
}

/** The rows referencing an organization that block deleting it. */
async function deleteOrganizationDependents(
  organizations: Array<Organization | undefined>,
): Promise<void> {
  for (const org of organizations) {
    if (!org) continue;
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
    await prisma.apiKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: org.id },
    });
  }
}

// Held for the whole file. The rollup this suite writes to and reads back is
// database-wide, so a neighbouring suite rebuilding it drops the materialised
// view out from under these fixtures.
holdClickHouseSchemaLockForFile();

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
    await dropSpendRowsForTenants([project?.id, foreignProject?.id]);
    await deleteOrganizationDependents([organization, foreignOrganization]);
    const projectIds = [project?.id ?? "", foreignProject?.id ?? ""];
    const organizationIds = [
      organization?.id ?? "",
      foreignOrganization?.id ?? "",
    ];
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.team.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await stopTestContainers();
  });

  /** @scenario Requests without an org API key are unauthorized */
  it("returns 401 without an api key", async () => {
    const res = await app.request("/api/gateway/v1/spend-events");
    await expectCanonicalError(res, {
      status: 401,
      type: "unauthenticated",
      code: "missing_credentials",
    });
  });

  describe("when the window runs backwards", () => {
    /** @scenario "An inverted window is refused on both reads" */
    it("refuses the rollups the same way the events already were", async () => {
      const inverted = "from=1768046410000&to=1768046400000";

      for (const path of [
        `/api/gateway/v1/spend-summaries?group_by=virtual_key&${inverted}`,
        `/api/gateway/v1/spend-events?${inverted}`,
      ]) {
        const res = await app.request(path, { headers: headers() });
        await expectCanonicalError(res, {
          status: 400,
          code: "validation_error",
        });
      }
    });
  });

  describe("when the credential is the wrong class for this surface", () => {
    /** @scenario "A project key on an organization endpoint is told exactly that" */
    it("names both the class required and the class presented", async () => {
      const res = await app.request("/api/gateway/v1/spend-summaries", {
        headers: { Authorization: `Bearer test-key-${ns}` },
      });

      const body = await expectCanonicalError(res, {
        status: 401,
        type: "unauthenticated",
        code: "credential_class_mismatch",
      });
      expect(body.meta).toMatchObject({
        required: "organization_api_key",
        presented: "project_api_key",
      });
    });

    /** @scenario "A credential that resolves to nothing is not blamed on its class" */
    it("says only that a token matching no key was not accepted", async () => {
      const res = await app.request("/api/gateway/v1/spend-summaries", {
        headers: { Authorization: `Bearer sk-lw-nosuchkey_${ns}` },
      });

      const body = await expectCanonicalError(res, {
        status: 401,
        type: "unauthenticated",
        code: "invalid_credentials",
      });
      // Naming a credential class here would send someone holding a typo to
      // swap a key that was never the problem.
      expect(body.message).not.toContain("roject");
    });
  });

  describe("canonical error envelope", () => {
    /** @scenario An unauthenticated request answers the canonical error envelope */
    it("answers an unauthenticated request with it", async () => {
      const res = await app.request("/api/gateway/v1/spend-summaries");
      await expectCanonicalError(res, {
        status: 401,
        type: "unauthenticated",
        code: "missing_credentials",
      });
    });

    /** @scenario A request-validation failure answers the canonical error envelope at 400 */
    it("answers a request-validation failure with it, at 400 and with the offending fields under meta", async () => {
      const res = await app.request(
        "/api/gateway/v1/spend-summaries?group_by=nonsense",
        { headers: headers() },
      );
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      expect(error.meta?.target).toBe("query");
      expect(error.meta?.fields).toEqual(
        expect.arrayContaining(["group_by", "from", "to"]),
      );
      // The reason chain names each offending field, in the wire's own
      // casing, so a caller never has to parse the sentence.
      const reasons = error.meta?.reasons as Array<{
        code: string;
        meta?: { field?: string };
      }>;
      expect(reasons.map((r) => r.meta?.field)).toEqual(
        expect.arrayContaining(["group_by"]),
      );
      expect(reasons.every((r) => r.code === "schema_failure")).toBe(true);
    });

    /** @scenario An unexpected server failure answers the canonical error envelope naming nothing internal */
    it("answers an unexpected server failure with it, naming nothing internal", async () => {
      const boom = vi
        .spyOn(GatewaySpendEventsRepository.prototype, "readSpendSummaries")
        .mockRejectedValueOnce(
          new Error('relation "GatewaySpendRecords" does not exist'),
        );
      try {
        const res = await app.request(
          `/api/gateway/v1/spend-summaries?group_by=virtual_key&from=${baseTime}&to=${baseTime + 1_000}`,
          { headers: headers() },
        );
        const error = await expectCanonicalError(res, {
          status: 500,
          type: "internal_error",
          code: "internal_error",
        });
        // The raised sentence names a table; the envelope must not.
        expect(error.message).not.toContain("GatewaySpendRecords");
      } finally {
        boom.mockRestore();
      }
    });
  });

  /** @scenario Without the plan flag the surface refuses politely */
  it("refuses without the enterprise plan flag", async () => {
    planHasWebhookEndpoints = false;
    try {
      const res = await app.request("/api/gateway/v1/spend-events", {
        headers: headers(),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error: { type: string; code: string; message: string };
      };
      expect(body.error.type).toBe("permission_denied");
      expect(body.error.message).toContain("enterprise");
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
    expect(res.status).toBe(400);
  });

  /** @scenario Replay re-delivers a window's envelopes to one endpoint through the delivery path */
  it("replays a window to one endpoint with unchanged envelope ids", async () => {
    const { WebhookEndpointService } = await import(
      "@ee/webhooks/webhookEndpoint.service"
    );
    const { WEBHOOK_DELIVERY_PROCESS_NAME } = await import(
      "@ee/webhooks/process-manager/webhookDelivery.process"
    );
    const previous = process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = "1";
    const endpoints = new WebhookEndpointService({ prisma });
    let endpointId = "";
    const ns2 = `${ns}-replay`;
    try {
      const created = await endpoints.create({
        organizationId: organization.id,
        url: "http://localhost:9/webhooks/replay-test",
        enabledEvents: ["gateway.request.completed"],
        // Zero delay: batches ship on append, so the outbox assertion
        // below sees them without simulating the coalescing wake.
        maxBatchDelayMs: 0,
      });
      endpointId = created.endpoint.id;

      await seed([
        spendRow(`${ns2}-a`, { occurredAt: new Date(baseTime + 500_000) }),
        spendRow(`${ns2}-b`, { occurredAt: new Date(baseTime + 501_000) }),
        // Settled is a different family: the completed-only endpoint must
        // not receive it, so it never counts toward the replay.
        spendRow(`${ns2}-s`, {
          status: "settled" as const,
          needsReconciliation: true,
          settleReason: "confirmation_deadline_expired",
          costUsd: "0.000000",
          occurredAt: new Date(baseTime + 502_000),
        }),
      ]);

      const res = await app.request("/api/gateway/v1/spend-events/replay", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          from: baseTime + 499_000,
          to: baseTime + 510_000,
          endpoint_id: endpointId,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { replayed: number; replay_id: string };
      };
      expect(body.data.replayed).toBe(2);

      // The replayed envelopes ride the REAL delivery stream: send-batch
      // messages exist for the endpoint, and the envelope ids inside are
      // the original type-suffixed ids, unchanged.
      // Endpoint streams are organization-keyed, so their outbox rows are
      // too.
      const messages = await prisma.processManagerOutbox.findMany({
        where: {
          processName: WEBHOOK_DELIVERY_PROCESS_NAME,
          projectId: { in: [organization.id] },
          messageKey: { startsWith: "send:" },
        },
      });
      const payloads = messages
        .map(
          (m) =>
            m.payload as {
              endpointId?: string;
              envelopes?: Array<{ id: string }>;
            },
        )
        .filter((p) => p.endpointId === endpointId);
      const ids = payloads.flatMap((p) => (p.envelopes ?? []).map((e) => e.id));
      expect(ids.sort()).toEqual([`${ns2}-a:completed`, `${ns2}-b:completed`]);

      // An inverted or over-wide window is refused.
      const inverted = await app.request(
        "/api/gateway/v1/spend-events/replay",
        {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({
            from: baseTime + 510_000,
            to: baseTime + 500_000,
            endpoint_id: endpointId,
          }),
        },
      );
      expect(inverted.status).toBe(400);
    } finally {
      if (previous === undefined) {
        delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
      } else {
        process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = previous;
      }
      if (endpointId) {
        await cleanupTestRows(prisma, [
          [
            "processManagerOutbox",
            {
              projectId: { in: [organization.id] },
              messageKey: { contains: endpointId },
            },
          ],
          [
            "processManagerInstance",
            {
              projectId: { in: [organization.id] },
              processKey: `endpoint:${endpointId}`,
            },
          ],
          ["webhookEndpoint", { id: endpointId }],
        ]);
      }
    }
  });

  /** @scenario An over-limit replay queues nothing */
  it("refuses an over-limit window before queuing a single envelope", async () => {
    const { WebhookEndpointService } = await import(
      "@ee/webhooks/webhookEndpoint.service"
    );
    const { WebhookEventsService } = await import(
      "@ee/webhooks/webhookEvents.service"
    );
    const previous = process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = "1";
    const endpoints = new WebhookEndpointService({ prisma });
    const emitted = vi.spyOn(
      WebhookEventsService.prototype,
      "getEmittedEvents",
    );
    let endpointId = "";
    const ns3 = `${ns}-flood`;
    try {
      const created = await endpoints.create({
        organizationId: organization.id,
        url: "http://localhost:9/webhooks/over-limit",
        enabledEvents: ["gateway.request.completed"],
        maxBatchDelayMs: 0,
      });
      endpointId = created.endpoint.id;

      // A window one envelope past the cap, served synthetically: the case
      // is about the cap, and seeding ten thousand ledger rows to reach it
      // would cost minutes for no extra coverage.
      const overLimit = 10_001;
      emitted.mockImplementation(async ({ cursor }) =>
        cursor
          ? { events: [], nextCursor: null }
          : {
              events: Array.from({ length: overLimit }, (_, i) => ({
                id: `${ns3}-${i}:completed`,
                type: "gateway.request.completed",
                created: new Date(baseTime + 600_000).toISOString(),
                schema_version: "1" as const,
                data: {
                  project_id: project.id,
                  gateway_request_id: `${ns3}-${i}`,
                },
              })),
              nextCursor: null,
            },
      );

      const res = await app.request("/api/gateway/v1/spend-events/replay", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          from: baseTime + 599_000,
          to: baseTime + 610_000,
          endpoint_id: endpointId,
        }),
      });
      expect(res.status).toBe(400);

      // Refused means nothing shipped: no stream row holds a buffered
      // envelope and no send message is waiting to go out. A partial
      // enqueue here would double-deliver on the caller's retry.
      // Endpoint streams are keyed at organization scope; the project id
      // is in the filter too so the check cannot pass by looking in the
      // wrong place.
      const streamScope = { in: [organization.id, project.id] };
      expect(
        await prisma.processManagerInstance.count({
          where: {
            projectId: streamScope,
            processKey: `endpoint:${endpointId}`,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.processManagerOutbox.count({
          where: {
            projectId: streamScope,
            messageKey: { contains: endpointId },
          },
        }),
      ).toBe(0);
    } finally {
      emitted.mockRestore();
      if (previous === undefined) {
        delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
      } else {
        process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = previous;
      }
      if (endpointId) {
        await cleanupTestRows(prisma, [
          ["webhookEndpoint", { id: endpointId }],
        ]);
      }
    }
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
    expect(row.cost.total_usd).toBe("0.05");
    expect(row.usage.input_tokens).toBe(200);
  });

  /** @scenario Summaries page by cursor instead of truncating at the limit */
  it("walks every key across pages and stops with a null cursor", async () => {
    const win = { from: baseTime + 300_000, to: baseTime + 310_000 };
    const keys = ["aaa", "bbb", "ccc"].map((k) => `${ns}-page-${k}`);
    await seed(
      keys.map((k, i) =>
        spendRow(`${ns}-page-${i}`, {
          endUserId: k,
          costUsd: "0.010000",
          occurredAt: new Date(win.from + 1_000 + i),
        }),
      ),
    );

    const page = async (cursor?: string) => {
      const q = new URLSearchParams({
        group_by: "end_user",
        from: String(win.from),
        to: String(win.to),
        limit: "2",
      });
      if (cursor) q.set("cursor", cursor);
      const res = await app.request(
        `/api/gateway/v1/spend-summaries?${q.toString()}`,
        { headers: headers() },
      );
      expect(res.status).toBe(200);
      return (await res.json()) as {
        data: Array<{ key: string }>;
        next_cursor: string | null;
      };
    };

    const first = await page();
    expect(first.data.map((r) => r.key)).toEqual(keys.slice(0, 2));
    // A full page must hand back a cursor: this is the truncation that used
    // to be silent, and a reconciliation that stops here loses a key.
    expect(first.next_cursor).not.toBeNull();

    const second = await page(first.next_cursor!);
    expect(second.data.map((r) => r.key)).toEqual(keys.slice(2));
    expect(second.next_cursor).toBeNull();

    // The walk is exact: every key once, none skipped, none repeated.
    expect([...first.data, ...second.data].map((r) => r.key)).toEqual(keys);
  });

  /** @scenario Summaries accept the same virtual_key_id filter as the events pull */
  it("narrows summaries to one virtual key", async () => {
    const win = { from: baseTime + 320_000, to: baseTime + 330_000 };
    await seed([
      spendRow(`${ns}-vkf-1`, {
        virtualKeyId: `${ns}-vk-keep`,
        endUserId: `${ns}-vkf-user-a`,
        occurredAt: new Date(win.from + 1_000),
      }),
      spendRow(`${ns}-vkf-2`, {
        virtualKeyId: `${ns}-vk-drop`,
        endUserId: `${ns}-vkf-user-b`,
        occurredAt: new Date(win.from + 2_000),
      }),
    ]);

    const res = await app.request(
      `/api/gateway/v1/spend-summaries?group_by=end_user&from=${win.from}&to=${win.to}&virtual_key_id=${ns}-vk-keep`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ key: string }> };
    expect(body.data.map((r) => r.key)).toEqual([`${ns}-vkf-user-a`]);
  });

  /** @scenario A garbled summaries cursor is refused, not silently reset */
  it("rejects an undecodable summaries cursor with the canonical 400", async () => {
    const res = await app.request(
      `/api/gateway/v1/spend-summaries?group_by=end_user&from=${baseTime}&to=${baseTime + 1_000}&cursor=${encodeURIComponent("%%%")}`,
      { headers: headers() },
    );
    await expectCanonicalError(res, { status: 400, type: "bad_request" });
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
        caps: unknown[];
      };
    };
    expect(body.data.cost.total_usd).toBe("0.05");
    expect(body.data.request_count).toBe(2);
    expect(body.data.usage.input_tokens).toBe(200);
    // No attributed-user template in this org: the caps list is empty,
    // never null, so consumers can iterate without a shape branch.
    expect(body.data.caps).toEqual([]);
  });

  /** @scenario The end-user spend endpoint returns spend and the applicable cap together */
  it("returns the applicable template caps beside the usage rollup", async () => {
    const templateAnchor = `vk-caps-${ns}`;
    const template = await prisma.gatewayBudget.create({
      data: {
        organizationId: organization.id,
        scopeType: "ATTRIBUTED_USER",
        scopeId: templateAnchor,
        name: `per-user-${ns}`,
        window: "MONTH",
        limitUsd: "100",
        onBreach: "BLOCK",
        resetsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        currentPeriodStartedAt: new Date(Date.now() - 60_000),
        createdById: userId,
      },
    });
    const budgetCH = new GatewayBudgetClickHouseRepository(
      async () => chClient,
    );
    await budgetCH.insertDebitsForBudgets([
      {
        tenantId: project.id,
        budgetId: template.id,
        scope: "ATTRIBUTED_USER",
        scopeId: `${templateAnchor}:${ns}-user-caps`,
        window: "MONTH",
        virtualKeyId: templateAnchor,
        providerKey: null,
        gatewayRequestId: `${ns}-caps-req`,
        amountNanoUsd: 12_500_000_000,
        tokensInput: 10,
        tokensOutput: 5,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        model: "gpt-x",
        durationMs: 10,
        status: "SUCCESS",
        occurredAt: new Date(),
      },
    ]);
    const res = await app.request(
      `/api/gateway/v1/end-users/${ns}-user-caps/spend?from=${baseTime}&to=${baseTime + 60_000}`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        caps: Array<{
          budget_id: string;
          anchor_id: string;
          limit_usd: string;
          spent_usd: string;
        }>;
      };
    };
    const cap = body.data.caps.find((c) => c.budget_id === template.id);
    expect(cap).toBeDefined();
    expect(cap!.anchor_id).toBe(templateAnchor);
    expect(cap!.limit_usd).toBe("100");
    expect(cap!.spent_usd).toBe("12.5");
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
    expect(body.data.cost.total_usd).toBe("0.01");
    expect(body.data.request_count).toBe(1);
  });

  // Through the route, because the guard has two halves and only one of them
  // is the grouping rule. The other is reading `allow_unstable` off a query
  // string, and that half shipped inverted: `z.coerce.boolean()` is
  // JavaScript `Boolean()`, so `allow_unstable=false` served the unstable read
  // it asked not to have. A test that calls the grouping check directly with a
  // boolean argument cannot see that, and the three scenarios below used to be
  // bound to exactly such a test.
  describe("when the grouping's key can move under the walk", () => {
    /** A window whose end is far enough back that outcomes can no longer arrive. */
    const settled = () => ({
      from: baseTime,
      to: baseTime + 60_000,
    });

    /** A window reaching now, so the fold can still rewrite model and provider. */
    const live = () => {
      const to = Date.now();
      return { from: to - 60_000, to };
    };

    const summaries = async (query: Record<string, string | number>) =>
      await app.request(
        `/api/gateway/v1/spend-summaries?${new URLSearchParams(
          Object.entries(query).map(([k, v]) => [k, String(v)]),
        ).toString()}`,
        { headers: headers() },
      );

    /** @scenario "Grouping on a movable key is refused while the window is still settling" */
    it("refuses a model grouping over a live window, naming which grouping moved", async () => {
      const res = await summaries({ group_by: "model", ...live() });

      const error = await expectCanonicalError(res, {
        status: 400,
        code: "gateway_spend_group_by_unstable",
      });
      // The dimension and the moment it settles, so a caller can retry
      // deliberately rather than guess how long to wait.
      expect(error.meta?.group_by).toEqual(["model"]);
      expect(Date.parse(String(error.meta?.settles_at))).toBeGreaterThan(
        Date.now(),
      );
    });

    /** @scenario "The same grouping is served once the window has settled" */
    it("serves the same grouping over a settled window", async () => {
      const res = await summaries({ group_by: "model", ...settled() });

      expect(res.status).toBe(200);
    });

    /** @scenario "Grouping on a key that cannot move is never refused" */
    it("never refuses a grouping whose key is fixed at admission", async () => {
      const res = await summaries({ group_by: "end_user", ...live() });

      expect(res.status).toBe(200);
    });

    /** @scenario "A caller who accepts the risk can ask for it anyway" */
    it("serves the movable grouping when the caller opts out", async () => {
      const res = await summaries({
        group_by: "model",
        allow_unstable: "true",
        ...live(),
      });

      expect(res.status).toBe(200);
    });

    /** @scenario "Declining an unstable read is not the same as accepting one" */
    it("still refuses when the caller spells the opt-out as false", async () => {
      const res = await summaries({
        group_by: "model",
        allow_unstable: "false",
        ...live(),
      });

      await expectCanonicalError(res, {
        status: 400,
        code: "gateway_spend_group_by_unstable",
      });
    });

    /** @scenario "The opt-out is read however the caller's HTTP library spells a boolean" */
    it("accepts the capitalised boolean a Python client sends", async () => {
      // `requests` renders a Python `True` as the string `True`, and the
      // documentation for this parameter is written for Python callers.
      for (const spelling of ["True", "TRUE", "Yes", "1"]) {
        const res = await summaries({
          group_by: "model",
          allow_unstable: spelling,
          ...live(),
        });

        expect(res.status, `allow_unstable=${spelling}`).toBe(200);
      }

      // And `False` still means no, which is the whole point of folding case
      // rather than accepting anything non-empty.
      const declined = await summaries({
        group_by: "model",
        allow_unstable: "False",
        ...live(),
      });
      await expectCanonicalError(declined, {
        status: 400,
        code: "gateway_spend_group_by_unstable",
      });
    });

    /** @scenario "A spelling the surface does not know is refused by name" */
    it("refuses a spelling it cannot read rather than guessing", async () => {
      const res = await summaries({
        group_by: "model",
        allow_unstable: "maybe",
        ...live(),
      });

      const error = await expectCanonicalError(res, {
        status: 400,
        code: "validation_error",
      });
      // Named, so a client can put the message on the field the caller got
      // wrong instead of on a toast that says something failed.
      expect(error.meta?.fields).toEqual(["allow_unstable"]);
    });

    /** @scenario "A cursor from another grouping is refused, not silently restarted" */
    it("refuses a cursor whose arity belongs to a different grouping", async () => {
      // Page one under a single dimension, then hand its cursor back asking
      // for two. Serving that would re-run page one under a fresh cursor with
      // nothing saying the walk reset, and the checksum would count those
      // groups twice.
      const first = await summaries({
        group_by: "end_user",
        limit: 1,
        ...settled(),
      });
      expect(first.status).toBe(200);
      const cursor = ((await first.json()) as { next_cursor: string | null })
        .next_cursor;
      expect(cursor).not.toBeNull();

      const res = await summaries({
        group_by: "end_user,virtual_key",
        cursor: cursor!,
        ...settled(),
      });

      await expectCanonicalError(res, { status: 400 });

      // A bucket adds a dimension too, so the same cursor is equally wrong
      // against a bucketed walk over the very grouping that minted it.
      const bucketed = await summaries({
        group_by: "end_user",
        bucket: "day",
        cursor: cursor!,
        ...settled(),
      });
      await expectCanonicalError(bucketed, { status: 400 });

      // The control: the cursor still works for the walk it belongs to.
      const resumed = await summaries({
        group_by: "end_user",
        limit: 1,
        cursor: cursor!,
        ...settled(),
      });
      expect(resumed.status).toBe(200);
    });

    /** @scenario "A time zone the store cannot load is refused at the door" */
    it("refuses a fixed offset in place of a named zone, naming the field", async () => {
      // The runtime builds a formatter for `+05:00` happily; ClickHouse loads
      // zones by name only and answers "Cannot load time zone +05:00". Left to
      // reach the store, a value the caller chose comes back as an unknown
      // error from somewhere they cannot see.
      const res = await summaries({
        group_by: "end_user",
        bucket: "day",
        timezone: "+05:00",
        ...settled(),
      });

      const error = await expectCanonicalError(res, {
        status: 400,
        code: "validation_error",
      });
      expect(error.meta?.fields).toEqual(["timezone"]);

      const named = await summaries({
        group_by: "end_user",
        bucket: "day",
        timezone: "Europe/Amsterdam",
        ...settled(),
      });
      expect(named.status).toBe(200);
    });
  });

  // Through both routes, because the contradiction only exists between them:
  // the rollup query drops in-flight rows with a fixed predicate, so a status
  // filter naming that status is the intersection of two disjoint sets. Read
  // one route at a time and everything looks consistent.
  describe("when the caller narrows to a status the rollups cannot answer", () => {
    const window = { from: baseTime + 890_000, to: baseTime + 910_000 };
    const virtualKeyId = `vk-inflight-${ns}`;

    /** One request still in flight, and one that completed and priced. */
    beforeAll(async () => {
      await seed([
        spendRow(`${ns}-inflight`, {
          status: "admitted" as const,
          virtualKeyId,
          // An admitted row carries no quantities and no cost: the fold sets
          // them only when an outcome lands. That is exactly why a rollup has
          // nothing to sum for it.
          tokensInput: 0,
          tokensOutput: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUsd: "0.000000",
          httpStatus: 0,
          occurredAt: new Date(baseTime + 900_000),
        }),
        spendRow(`${ns}-completed`, {
          virtualKeyId,
          occurredAt: new Date(baseTime + 901_000),
        }),
      ]);
    });

    const read = async ({
      path,
      query,
    }: {
      path: string;
      query: Record<string, string | number>;
    }): Promise<Response> =>
      await app.request(
        `/api/gateway/v1/${path}?${new URLSearchParams(
          Object.entries({
            ...window,
            virtual_key_id: virtualKeyId,
            ...query,
          }).map(([k, v]) => [k, String(v)]),
        ).toString()}`,
        { headers: headers() },
      );

    /** @scenario "The rollups refuse a status they can only answer with zero" */
    it("serves the in-flight envelopes on the events read", async () => {
      const res = await read({
        path: "spend-events",
        query: { status: "admitted" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ data: { gateway_request_id: string; status: string } }>;
      };
      expect(body.data.map((e) => e.data.gateway_request_id)).toEqual([
        `${ns}-inflight`,
      ]);
      expect(body.data[0]?.data.status).toBe("admitted");
    });

    /** @scenario "The rollups refuse a status they can only answer with zero" */
    it("refuses the identical narrowing on the rollups, naming the field", async () => {
      const res = await read({
        path: "spend-summaries",
        query: { status: "admitted", group_by: "virtual_key" },
      });

      const error = await expectCanonicalError(res, {
        status: 400,
        code: "validation_error",
      });
      // A 200 with an empty page would be the real bug: a reconciliation that
      // checksums against that zero decides the books agree.
      expect(error.meta?.fields).toEqual(["status"]);
    });

    /** @scenario "The rollups refuse a status they can only answer with zero" */
    it("still accepts a completed status on the rollups", async () => {
      const res = await read({
        path: "spend-summaries",
        query: { status: "confirmed", group_by: "virtual_key" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ key: string; event_count: number }>;
      };
      expect(body.data).toEqual([
        expect.objectContaining({ key: virtualKeyId, event_count: 1 }),
      ]);
    });
  });
});

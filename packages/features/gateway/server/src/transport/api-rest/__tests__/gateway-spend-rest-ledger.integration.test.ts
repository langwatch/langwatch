/**
 * @vitest-environment node
 *
 * The billing reconciliation REST surface over the REAL ledger: real
 * ClickHouse for the spend and budget rows, real Postgres for the tenancy the
 * filters name.
 *
 * These are the properties no double can stand in for — insert-order paging
 * that never skips a late fold, the tenant fence, and the arithmetic the
 * rollups and the end-user read publish. The boundary decisions in front of
 * them (auth, plan gate, cursor and window validation) are pinned in
 * `apps/api`, against the process's own credential chain.
 *
 * The organization on the context is installed the way the process's chain
 * installs it; everything behind it is production code.
 *
 * Spec: specs/ai-gateway/gateway-spend-rest.feature
 * Spec: specs/ai-gateway/billing-spend-events.feature
 * Spec: specs/ai-gateway/end-user-attribution.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { MiddlewareHandler } from "hono";

import { FixedGatewaySettlementPolicyAdapter } from "../../../adapters/fixed-gateway-settlement.adapter";
import { GatewayEndUserCapsAdapter } from "../../../adapters/gateway-end-user-caps.adapter";
import { GatewaySpendScopeAdapter } from "../../../adapters/gateway-spend-scope.adapter";
import { GatewayBudgetClickHouseRepository } from "../../../repositories/clickhouse/clickhouse.gateway-budget.repository";
import { GatewaySpendEventsRepository } from "../../../repositories/clickhouse/clickhouse.gateway-spend-events.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";
import { GatewaySpendEventsService } from "../../../services/gateway-spend-events.service";
import { createGatewaySpendRestApp, type GatewaySpendRestPorts } from "../gateway-spend.api";
import { testRestSecurity } from "./support/rest-security.support";

import type { SpendEventRow } from "../../../ports/gateway-spend-events.port";
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const chUrl = testClickHouseUrl();
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `billing-api-${nanoid(8)}`;
const ORG_ID = `org-${ns}`;
const FOREIGN_ORG_ID = `org-foreign-${ns}`;
const TEAM_ID = `team-${ns}`;
const FOREIGN_TEAM_ID = `team-foreign-${ns}`;
const PROJECT_ID = `proj-${ns}`;
const FOREIGN_PROJECT_ID = `proj-foreign-${ns}`;
const USER_ID = `usr-${ns}`;
const baseTime = Date.UTC(2026, 0, 10, 12, 0, 0);

let client: ClickHouseClient;
let repo: GatewaySpendEventsRepository;
let budgets: GatewayBudgetClickHouseRepository;
let app: ReturnType<typeof createGatewaySpendRestApp>;

/**
 * The canonical envelope, reduced to the two fields these scenarios read.
 *
 * The wire format itself belongs to the Enterprise webhook platform, which
 * this package may not depend on and whose mapping is pinned in its own
 * suite. What matters here is that the id carries the request and its family,
 * so a page walk and a tenant fence can be asserted on the join key.
 */
function testEnvelope(row: SpendEventRow) {
  const family = row.status === "confirmed" ? "completed" : row.status;
  return {
    id: `${row.gatewayRequestId}:${family}`,
    type: `gateway.request.${family}`,
    created: row.occurredAt.toISOString(),
    schema_version: "1",
    data: { gateway_request_id: row.gatewayRequestId, status: row.status },
  };
}

/** The organization the process's credential chain would have installed. */
const installOrganization: MiddlewareHandler = async (c, next) => {
  c.set("organization", { id: ORG_ID });
  await next();
};

function buildApp(): void {
  repo = new GatewaySpendEventsRepository(async () => client);
  budgets = new GatewayBudgetClickHouseRepository(async () => client);
  const scope = GatewaySpendScopeAdapter.create({ database: prisma });
  const refuse = () => {
    throw new Error("the replay path is not under test here");
  };
  const ports: GatewaySpendRestPorts = {
    spendEvents: GatewaySpendEventsService.create(repo),
    budgetSpend: budgets,
    webhookEndpoints: { tryGetDeliverable: refuse },
    webhookEvents: undefined,
    webhookDelivery: undefined,
    spendEventEnvelope: testEnvelope,
    endpointAcceptsEvent: () => true,
    settlementPolicy: FixedGatewaySettlementPolicyAdapter.create(15 * 60_000),
    resolveSpendScope: (input) => {
      scope.clearCache();
      return scope.resolveSpendScope(input);
    },
    endUserCaps: ({ budgetRepository, organizationId, endUserId, tenantIds, virtualKeyId }) =>
      GatewayEndUserCapsAdapter.create({ database: prisma, spend: budgetRepository }).forEndUser({
        organizationId,
        endUserId,
        tenantIds,
        ...(virtualKeyId === undefined ? {} : { virtualKeyId }),
      }),
    spendStoreUnavailable: () => new Error("the spend store is unreachable"),
  };
  app = createGatewaySpendRestApp({
    security: testRestSecurity({
      organizationAuth: installOrganization,
      organizationPermission: async (_c, next) => {
        await next();
      },
    }),
    billingPlanGate: async (_c, next) => {
      await next();
    },
    canonicalError: (error) => ({
      status: 500,
      body: {
        error: { type: "internal_error", code: "internal_error", message: String(error) },
      } as never,
    }),
    spend: () => ports,
  });
}

async function get(path: string): Promise<Response> {
  return await app.hono.fetch(new Request(`http://api.test${path}`));
}

function spendRow(requestId: string, overrides: Partial<SpendEventRow> = {}): SpendEventRow {
  return {
    tenantId: PROJECT_ID,
    gatewayRequestId: requestId,
    organizationId: ORG_ID,
    teamId: TEAM_ID,
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
    status: "confirmed",
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
  };
}

// The write path is the fold's upsert, so tests seed by mapping a row to the
// fold state it would have produced. Write stamps are strictly monotonic: the
// walk pages by (EventTimestamp, GatewayRequestId), and two seeds landing in
// the same millisecond would tie, letting the id tiebreak place a later
// insert behind an already-served cursor.
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
          cache_creation_1h_tokens: 0,
          input_audio_tokens: 0,
          output_audio_tokens: 0,
          input_image_tokens: 0,
          output_image_tokens: 0,
          image_count: 0,
          input_chars: 0,
          audio_ms: 0,
        },
        rateVersion: row.rateVersion,
        // Overrides set the display string; derive the integer so both stay
        // consistent however the row was authored.
        costNanoUsd: Math.round(Number(row.costUsd) * 1_000_000_000),
        errorType: row.errorClass,
        httpStatus: row.httpStatus,
        needsReconciliation: row.needsReconciliation,
        settleReason: row.settleReason,
        occurredAtMs: row.occurredAt.getTime(),
        durationMs: row.durationMs,
        // Write-time stamps: the walk pages by insert order, so the version
        // must be the seed instant, never the occurred-at.
        createdAt: ++seedClock,
        updatedAt: ++seedClock,
        LastEventOccurredAt: row.occurredAt.getTime(),
      },
    })) as never,
  );
}

describe.skipIf(!databaseUrl || !chUrl)(
  "gateway spend reconciliation over the real ledger (real PG + real CH)",
  () => {
    beforeAll(async () => {
      client = createTestClickHouseClient(chUrl!);
      buildApp();

      for (const tenant of [
        { orgId: ORG_ID, teamId: TEAM_ID, projectId: PROJECT_ID, label: "own" },
        {
          orgId: FOREIGN_ORG_ID,
          teamId: FOREIGN_TEAM_ID,
          projectId: FOREIGN_PROJECT_ID,
          label: "foreign",
        },
      ]) {
        await prisma.organization.create({
          data: { id: tenant.orgId, name: `Billing ${tenant.label}`, slug: tenant.orgId },
        });
        await prisma.team.create({
          data: {
            id: tenant.teamId,
            name: `Billing team ${tenant.label}`,
            slug: tenant.teamId,
            organizationId: tenant.orgId,
          },
        });
        await prisma.project.create({
          data: {
            id: tenant.projectId,
            name: `Billing project ${tenant.label}`,
            slug: tenant.projectId,
            teamId: tenant.teamId,
            language: "other",
            framework: "other",
            apiKey: `key-${tenant.projectId}`,
          },
        });
      }
      await prisma.user.create({
        data: { id: USER_ID, email: `${ns}@example.com`, name: "Billing Test User" },
      });
    }, 120_000);

    afterAll(async () => {
      if (!databaseUrl || !chUrl) return;
      for (const tenantId of [PROJECT_ID, FOREIGN_PROJECT_ID]) {
        await client.command({
          query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenantId}'`,
        });
        await client.command({
          query: `ALTER TABLE gateway_budget_ledger_events DELETE WHERE TenantId = '${tenantId}'`,
        });
      }
      await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.project.deleteMany({
        where: { id: { in: [PROJECT_ID, FOREIGN_PROJECT_ID] } },
      });
      await prisma.team.deleteMany({ where: { id: { in: [TEAM_ID, FOREIGN_TEAM_ID] } } });
      await prisma.user.deleteMany({ where: { id: USER_ID } });
      await prisma.organization.deleteMany({
        where: { id: { in: [ORG_ID, FOREIGN_ORG_ID] } },
      });
    }, 120_000);

    describe("when a caller walks the pull while the fold is still writing", () => {
      /** @scenario "Pagination under concurrent inserts never skips a row" */
      it("serves late-folded rows on later pages of an in-flight walk", async () => {
        await seed([
          spendRow(`${ns}-r1`, { occurredAt: new Date(baseTime + 1_000) }),
          spendRow(`${ns}-r2`, { occurredAt: new Date(baseTime + 2_000) }),
        ]);
        await seed([spendRow(`${ns}-r3`, { occurredAt: new Date(baseTime + 3_000) })]);

        const window = `from=${baseTime - 120_000}&to=${baseTime + 600_000}`;
        const firstResponse = await get(`/api/gateway/v1/spend-events?limit=2&${window}`);
        expect(firstResponse.status).toBe(200);
        const first = (await firstResponse.json()) as {
          data: Array<{ id: string }>;
          next_cursor: string | null;
        };
        expect(first.data).toHaveLength(2);
        expect(first.next_cursor).not.toBeNull();

        // A late fold: OLDER occurred-at than everything served, inserted
        // while the walk is mid-flight. Insert-order pagination must still
        // serve it.
        await seed([spendRow(`${ns}-late`, { occurredAt: new Date(baseTime - 60_000) })]);

        const seen: string[] = first.data.map((event) => event.id);
        let cursor = first.next_cursor;
        while (cursor !== null) {
          const response = await get(
            `/api/gateway/v1/spend-events?limit=2&${window}&cursor=${encodeURIComponent(cursor)}`,
          );
          expect(response.status).toBe(200);
          const page = (await response.json()) as {
            data: Array<{ id: string }>;
            next_cursor: string | null;
          };
          seen.push(...page.data.map((event) => event.id));
          cursor = page.next_cursor;
        }

        expect(seen).toContain(`${ns}-late:completed`);
        expect(new Set(seen).size).toBe(seen.length);
      });

      /** @scenario "The pull is org-fenced" */
      it("never serves another organization's rows", async () => {
        await seed([
          {
            ...spendRow(`${ns}-foreign`),
            tenantId: FOREIGN_PROJECT_ID,
            organizationId: FOREIGN_ORG_ID,
          },
        ]);

        const response = await get(
          `/api/gateway/v1/spend-events?limit=200&from=${baseTime - 120_000}&to=${baseTime + 600_000}`,
        );

        // Envelope ids are family-suffixed, so the fence must assert on the
        // raw join key or it can never fail.
        const body = (await response.json()) as {
          data: Array<{ data: { gateway_request_id: string } }>;
        };
        expect(body.data.map((event) => event.data.gateway_request_id)).not.toContain(
          `${ns}-foreign`,
        );
      });
    });

    describe("when the caller asks for the rollup instead of the items", () => {
      /** @scenario "Per key summaries roll up priced outcomes with settled counted separately" */
      it("summarizes by end user with settled counted apart from cost", async () => {
        const endUser = `${ns}-sum-user`;
        await seed([
          spendRow(`${ns}-sum-1`, {
            endUserId: endUser,
            costUsd: "0.020000",
            occurredAt: new Date(baseTime + 40_000),
          }),
          spendRow(`${ns}-sum-2`, {
            endUserId: endUser,
            costUsd: "0.030000",
            occurredAt: new Date(baseTime + 41_000),
          }),
          // Nonzero on purpose: if the aggregation ever sums settled rows,
          // the cost and token assertions below must fail, not coast on zero.
          spendRow(`${ns}-sum-settled`, {
            endUserId: endUser,
            status: "settled",
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

        const response = await get(
          `/api/gateway/v1/spend-summaries?group_by=end_user&from=${baseTime + 39_000}&to=${baseTime + 50_000}`,
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: Array<{
            key: string;
            event_count: number;
            settled_count: number;
            usage: { input_tokens: number };
            cost: { total_usd: string; nano_usd: number };
          }>;
        };
        const row = body.data.find((candidate) => candidate.key === endUser)!;
        expect(row).toBeDefined();
        expect(row.event_count).toBe(2);
        expect(row.settled_count).toBe(1);
        expect(row.cost.nano_usd).toBe(50_000_000);
        expect(row.cost.total_usd).toBe("0.05");
        expect(row.usage.input_tokens).toBe(200);
      });

      /** @scenario "Summaries page by cursor instead of truncating at the limit" */
      it("walks every key across pages and stops with a null cursor", async () => {
        const window = { from: baseTime + 300_000, to: baseTime + 310_000 };
        const keys = ["aaa", "bbb", "ccc"].map((key) => `${ns}-page-${key}`);
        await seed(
          keys.map((key, index) =>
            spendRow(`${ns}-page-${index}`, {
              endUserId: key,
              costUsd: "0.010000",
              occurredAt: new Date(window.from + 1_000 + index),
            }),
          ),
        );

        const page = async (cursor?: string) => {
          const query = new URLSearchParams({
            group_by: "end_user",
            from: String(window.from),
            to: String(window.to),
            limit: "2",
          });
          if (cursor) query.set("cursor", cursor);
          const response = await get(`/api/gateway/v1/spend-summaries?${query.toString()}`);
          expect(response.status).toBe(200);
          return (await response.json()) as {
            data: Array<{ key: string }>;
            next_cursor: string | null;
          };
        };

        const first = await page();
        expect(first.data.map((row) => row.key)).toEqual(keys.slice(0, 2));
        // A full page must hand back a cursor: this is the truncation that
        // used to be silent, and a reconciliation that stops here loses a key.
        expect(first.next_cursor).not.toBeNull();

        const second = await page(first.next_cursor!);
        expect(second.data.map((row) => row.key)).toEqual(keys.slice(2));
        expect(second.next_cursor).toBeNull();

        // The walk is exact: every key once, none skipped, none repeated.
        expect([...first.data, ...second.data].map((row) => row.key)).toEqual(keys);
      });

      /** @scenario "Summaries accept the same virtual_key_id filter as the events pull" */
      it("narrows summaries to one virtual key", async () => {
        const window = { from: baseTime + 320_000, to: baseTime + 330_000 };
        await seed([
          spendRow(`${ns}-vkf-1`, {
            virtualKeyId: `${ns}-vk-keep`,
            endUserId: `${ns}-vkf-user-a`,
            occurredAt: new Date(window.from + 1_000),
          }),
          spendRow(`${ns}-vkf-2`, {
            virtualKeyId: `${ns}-vk-drop`,
            endUserId: `${ns}-vkf-user-b`,
            occurredAt: new Date(window.from + 2_000),
          }),
        ]);

        const response = await get(
          `/api/gateway/v1/spend-summaries?group_by=end_user&from=${window.from}&to=${window.to}&virtual_key_id=${ns}-vk-keep`,
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as { data: Array<{ key: string }> };
        expect(body.data.map((row) => row.key)).toEqual([`${ns}-vkf-user-a`]);
      });
    });

    describe("when a rebilling integration polls one end user", () => {
      /** @scenario "The end-user rollup sums exactly that user's requests in the window" */
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

        const response = await get(
          `/api/gateway/v1/end-users/${ns}-user-1/spend?from=${baseTime}&to=${baseTime + 60_000}`,
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
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
        // No attributed-user template applies to this one: the caps list is
        // empty, never null, so consumers iterate without a shape branch.
        expect(body.data.caps).toEqual([]);
      });

      /** @scenario "A virtual key filter narrows the rollup" */
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

        const response = await get(
          `/api/gateway/v1/end-users/${ns}-user-3/spend?from=${baseTime}&to=${baseTime + 60_000}&virtual_key_id=vk-a`,
        );

        const body = (await response.json()) as {
          data: { cost: { total_usd: string }; request_count: number };
        };
        expect(body.data.cost.total_usd).toBe("0.01");
        expect(body.data.request_count).toBe(1);
      });

      /** @scenario "The end-user spend endpoint returns spend and the applicable cap together" */
      it("returns the applicable template caps beside the usage rollup", async () => {
        const templateAnchor = `vk-caps-${ns}`;
        const template = await prisma.gatewayBudget.create({
          data: {
            organizationId: ORG_ID,
            scopeType: "ATTRIBUTED_USER",
            scopeId: templateAnchor,
            name: `per-user-${ns}`,
            window: "MONTH",
            limitUsd: "100",
            onBreach: "BLOCK",
            resetsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            currentPeriodStartedAt: new Date(Date.now() - 60_000),
            createdById: USER_ID,
          },
        });
        await budgets.insertDebitsForBudgets([
          {
            tenantId: PROJECT_ID,
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

        const response = await get(
          `/api/gateway/v1/end-users/${ns}-user-caps/spend?from=${baseTime}&to=${baseTime + 60_000}`,
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: {
            caps: Array<{
              budget_id: string;
              anchor_id: string;
              limit_usd: string;
              spent_usd: string;
            }>;
          };
        };
        const cap = body.data.caps.find((candidate) => candidate.budget_id === template.id);
        expect(cap).toBeDefined();
        expect(cap!.anchor_id).toBe(templateAnchor);
        expect(cap!.limit_usd).toBe("100");
        expect(cap!.spent_usd).toBe("12.5");
      });
    });
  },
);

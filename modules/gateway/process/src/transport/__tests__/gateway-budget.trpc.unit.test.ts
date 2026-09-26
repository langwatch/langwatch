import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * What the budgets list hands the UI: standing (people over their own cap)
 * and the Scope column's anchor name, off the real control plane.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ResourceScope } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "../../app/gateway.app.ts";
import { gatewayBudgetTrpcTransport } from "../gateway-budget.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

/** The process members a mounted declaration runs on, as this suite supplies them. */
function testPorts(
  permits: (permission: AuthzPermission) => boolean = () => true,
): TrpcRuntimeMembers<GatewayTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

/** A peer that answers nothing: the composition resolves it, no test call reaches it. */
function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

const ORG_ID = "org_1";
const ANCHOR_VK_ID = "vk_anchor";
const ANCHOR_PROJECT_ID = "project_anchor";
const TENANT_PROJECT_ID = "project_1";

/** Decimal money, as the contract asks for it: stringable and DB-library-free. */
const money = (value: string) => ({
  toString: () => value,
  toFixed: () => value,
});

/** The raw shape `prisma.gatewayBudget.findMany` answers a row in. */
function budgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bdg_template",
    organizationId: ORG_ID,
    scopeType: "ATTRIBUTED_USER",
    scopeId: ANCHOR_VK_ID,
    name: "per person",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: money("1.00"),
    spentUsd: money("0.00"),
    timezone: null,
    providerKey: null,
    externalId: null,
    metadata: null,
    currentPeriodStartedAt: new Date("2099-01-01T00:00:00Z"),
    resetsAt: new Date("2099-02-01T00:00:00Z"),
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    createdById: "usr_1",
    managedByVirtualKeyId: null,
    ...overrides,
  };
}

let bucketRows: { ScopeId: string; SpentNanoUSD: string }[] = [];

const clickHouseQuery = vi.fn(async (input: { sql: string }) => {
  // The per-budget rollup totals (BudgetId, Scope, ScopeId) are never
  // asserted here — only the per-person bucket breakdown (ScopeId alone) is.
  if (input.sql.includes("GROUP BY BudgetId")) return { rows: [] };
  return { rows: bucketRows };
});

/** A fake ClickHouse client answering the budget spend + per-person bucket reads. */
function fakeClickHouse(): ClickHouseQueryClient {
  return clickHouseQueryClientDouble({
    query: clickHouseQuery,
    insert: async () => {},
  });
}

const virtualKeyFindMany = vi.fn(async (args?: { where?: { id?: unknown } }) => {
  // The attributed-user anchor lookup names the ids it wants; the scope-reach
  // candidate walk (below every `listWithHealth`) names none - no active keys
  // is a legitimate answer there, since no test needs a reach fact.
  const id = args?.where?.id;
  if (!id) return [];

  const requestedIds = typeof id === "object" && "in" in id && Array.isArray(id.in) ? id.in : [];
  return requestedIds.includes(ANCHOR_VK_ID)
    ? [{ id: ANCHOR_VK_ID, name: "prod-openai", displayPrefix: "lw_sk_ab" }]
    : [];
});

/** A fake Prisma client answering the budget row, its bucket boundaries and its scope anchor. */
function fakePrisma(budgets: Record<string, unknown>[]): PrismaClient {
  return prismaDouble({
    organization: { findUnique: async () => ({ id: ORG_ID }) },
    gatewayBudget: { findMany: async () => budgets },
    gatewayBudgetBucketBoundary: { findMany: async () => [] },
    virtualKey: { findMany: virtualKeyFindMany },
  });
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

async function callerFor(budgets: Record<string, unknown>[]) {
  const app = await GatewayApp.create({
    dependencies: {
      webhooks: peer("webhooks"),
      entitlement: peer("entitlement"),
      authz: peer("authz"),
      projects: projectsStub({
        findOrganizationId: async () => ORG_ID,
        listIdsByOrganization: async () => [TENANT_PROJECT_ID],
        // The scope-reach walk resolves a destination per active key's trace
        // project; no test here supplies an active key, so this is never fed
        // a non-empty list.
        listTraceDestinations: async () => [],
        listNamesByIds: async ({ projectIds }) =>
          projectIds
            .filter((id) => id === ANCHOR_PROJECT_ID)
            .map((id) => ({
              id,
              name: "gateway-demo",
              slug: "gateway-demo",
              teamId: "team_1",
              organizationId: ORG_ID,
              isPersonal: false,
              ownerUserId: null,
            })),
      }),
      evaluators: peer("evaluators"),
      monitors: peer("monitors"),
      organizations: peer("organizations"),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
    },
    members: {
      prisma: fakePrisma(budgets),
      clickhouse: fakeClickHouse(),
      gatewayInternalProtocol: {},
      encryption: createApiFixture<Encryption>(),
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: testPorts(),
  }).mount(gatewayBudgetTrpcTransport, () => app);

  return router.createCaller({ actor: { id: "usr_1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  bucketRows = [];
  virtualKeyFindMany.mockClear();
});

describe("gatewayBudgets.list for a per-person template", () => {
  describe("given a template the ledger has seen people under", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("carries the per-person standing onto the wire", async () => {
      // One anchor over its own $1.00 cap, one still under it.
      bucketRows = [
        { ScopeId: "enduser-over", SpentNanoUSD: "1500000000" },
        { ScopeId: "enduser-under", SpentNanoUSD: "500000000" },
      ];

      const { budgets } = await (await callerFor([budgetRow()])).list({ organizationId: ORG_ID });

      expect(budgets[0]?.endUsersSeen).toBe(2);
      expect(budgets[0]?.endUsersOver).toBe(1);
    });
  });

  describe("given a template nobody has used yet", () => {
    /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
    it("reports zero seen and zero over", async () => {
      bucketRows = [];

      const { budgets } = await (await callerFor([budgetRow()])).list({ organizationId: ORG_ID });

      expect(budgets[0]?.endUsersSeen).toBe(0);
      expect(budgets[0]?.endUsersOver).toBe(0);
    });
  });

  describe("given a template anchored on a virtual key", () => {
    /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
    it("names the virtual key the template anchors on", async () => {
      const { budgets } = await (await callerFor([budgetRow()])).list({ organizationId: ORG_ID });

      expect(budgets[0]?.scopeTarget).toMatchObject({
        kind: "ATTRIBUTED_USER",
        id: ANCHOR_VK_ID,
        name: "prod-openai",
        secondary: "lw_sk_ab…",
      });
    });
  });

  describe("given a template anchored on a project", () => {
    /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
    it("names the project the template anchors on", async () => {
      const { budgets } = await (
        await callerFor([budgetRow({ scopeId: ANCHOR_PROJECT_ID })])
      ).list({
        organizationId: ORG_ID,
      });

      expect(budgets[0]?.scopeTarget).toMatchObject({
        kind: "ATTRIBUTED_USER",
        id: ANCHOR_PROJECT_ID,
        name: "gateway-demo",
      });
    });
  });

  describe("given a scope that is not a per-person template", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("leaves the standing null", async () => {
      const { budgets } = await (
        await callerFor([
          budgetRow({
            id: "bdg_project",
            scopeType: "PROJECT",
            scopeId: ANCHOR_PROJECT_ID,
          }),
        ])
      ).list({ organizationId: ORG_ID });

      expect(budgets[0]?.endUsersSeen).toBeNull();
      expect(budgets[0]?.endUsersOver).toBeNull();
    });
  });
});

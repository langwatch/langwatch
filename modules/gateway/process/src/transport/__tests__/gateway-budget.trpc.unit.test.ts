import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * What the budgets list hands the UI: standing (people over their own cap)
 * and the Scope column's anchor name, off the real control plane.
 */
import type { GatewayBudget, GatewayBudgetDebitRow } from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { nowInstant, Temporal } from "@langwatch/time";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { GatewayModule } from "../../app/gateway.app.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
} from "../../repositories/memory/memory.gateway.store.ts";
import { gatewayBudgetTrpcTransport } from "../gateway-budget.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

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

/** A per-person template on the anchor key, in a period that began an hour ago. */
function budgetRow(overrides: Partial<GatewayBudget> = {}): GatewayBudget {
  const now = nowInstant();
  return {
    id: "bdg_template",
    organizationId: ORG_ID,
    scopeType: "ATTRIBUTED_USER",
    scopeId: ANCHOR_VK_ID,
    name: "per person",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: memoryGatewayDecimal("1.00"),
    spentUsd: memoryGatewayDecimal("0.00"),
    timezone: null,
    providerKey: null,
    externalId: null,
    metadata: null,
    currentPeriodStartedAt: now.subtract({ hours: 1 }),
    resetsAt: now.add({ hours: 24 * 30 }),
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    createdById: "usr_1",
    managedByVirtualKeyId: null,
    ...overrides,
  };
}

/** One person's spend under the template, debited to their own bucket. */
function personalDebit(endUserId: string, amountNanoUsd: number): GatewayBudgetDebitRow {
  return {
    tenantId: TENANT_PROJECT_ID,
    budgetId: "bdg_template",
    scope: "ATTRIBUTED_USER",
    scopeId: `${ANCHOR_VK_ID}:${endUserId}`,
    window: "MONTH",
    virtualKeyId: ANCHOR_VK_ID,
    gatewayRequestId: `req_${endUserId}`,
    amountNanoUsd,
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-5",
    status: "SUCCESS",
    occurredAt: nowInstant(),
  };
}

/** The gateway's memory twins holding the budgets, the anchor key and the debits a test names. */
async function seededRepositories({
  budgets,
  debits,
}: {
  budgets: GatewayBudget[];
  debits: GatewayBudgetDebitRow[];
}) {
  const store = MemoryGatewayStore.create();
  for (const budget of budgets) store.budgets.set(budget.id, budget);
  const { repositories } = new MemoryGatewayRepositories(store);
  await repositories.virtualKeys.create({
    ...memoryVirtualKeySeed({ id: ANCHOR_VK_ID, name: "prod-openai", organizationId: ORG_ID }),
    displayPrefix: "lw_sk_ab",
  });
  for (const debit of debits) await repositories.budgetSpend.insertDebit([debit]);
  return repositories;
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

async function callerFor(budgets: GatewayBudget[], debits: GatewayBudgetDebitRow[] = []) {
  const repositories = await seededRepositories({ budgets, debits });
  const app = await GatewayModule.create({
    dependencies: {
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
      evaluations: peer("evaluations"),
      monitors: peer("monitors"),
      organizations: createApiFixture<OrganizationApi>({
        findProvisioningSummary: async (organizationId) => ({
          id: organizationId,
          name: "Organization",
          slug: "organization",
          createdAt: nowInstant(),
        }),
      }),
      featureFlags: peer("featureFlags"),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
      apiKeys: peer("apiKeys"),
    },
    repositories,
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<GatewayTrpcTestContext>(),
  }).mount(gatewayBudgetTrpcTransport, () => app);

  return router.createCaller({ actor: { id: "usr_1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gatewayBudgets.list for a per-person template", () => {
  describe("given a template the ledger has seen people under", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("carries the per-person standing onto the wire", async () => {
      // One person over their own $1.00 cap, one still under it.
      const debits = [
        personalDebit("enduser-over", 1_500_000_000),
        personalDebit("enduser-under", 500_000_000),
      ];

      const { budgets } = await (
        await callerFor([budgetRow()], debits)
      ).list({
        organizationId: ORG_ID,
      });

      expect(budgets[0]?.endUsersSeen).toBe(2);
      expect(budgets[0]?.endUsersOver).toBe(1);
    });
  });

  describe("given a template nobody has used yet", () => {
    /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
    it("reports zero seen and zero over", async () => {
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

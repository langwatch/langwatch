/**
 * @vitest-environment node
 *
 * What the budgets list hands the UI for a per-person template.
 *
 * Two things the screen cannot render without: the standing (how many people
 * are over their own cap) and the Scope column's anchor name. Both are computed
 * behind the budget-decision service and covered there; what this file pins is
 * that the transport carries them onto the wire unchanged rather than dropping
 * them in the projection.
 *
 * Moved here with the surface. Where the version in the retired application
 * drove the whole chain through a mocked Prisma client, this one stands in for
 * the budget-decision service, because that service is now the seam the
 * transport talks to. The ledger arithmetic behind the standing keeps its own
 * coverage in `gateway-budget-dto.unit.test.ts`.
 */
import type { GatewayService } from "@langwatch/gateway-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayBudgetTrpcApi } from "../src/api/app-trpc/gateway-budget.api";
import { GatewayApp, type GatewayAppDependencies } from "../src/app/gateway.app";

/** The slice of the application this surface reaches, and nothing else. */
function gatewayAppStub(dependencies: Partial<GatewayAppDependencies>): GatewayApp {
  return GatewayApp.create(dependencies as GatewayAppDependencies);
}

function budgetDecisionsStub(overrides: Partial<GatewayService>): GatewayService {
  return overrides as GatewayService;
}

function projectsStub(overrides: Partial<ProjectService>): ProjectService {
  return overrides as ProjectService;
}

const ORG_ID = "org_1";
const ANCHOR_VK_ID = "vk_anchor";
const ANCHOR_PROJECT_ID = "project_anchor";

/** Decimal money, as the contract asks for it: stringable and DB-library-free. */
const money = (value: string) => ({
  toString: () => value,
  toFixed: () => value,
});

function template(overrides: Record<string, unknown> = {}) {
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
    endUsersSeen: 2,
    endUsersOver: 1,
    ...overrides,
  };
}

const listWithHealth = vi.fn();
const resolveScopeTargets = vi.fn();
const assertOrganizationExists = vi.fn();
const resolveProviderLabels = vi.fn();
const listGroupTargets = vi.fn();

function callerFor(budgets: Array<Record<string, unknown>>) {
  const trpc = initTRPC
    .context<{
      app: { gateway: GatewayApp };
      actor(): { id: string };
    }>()
    .create();

  listWithHealth.mockResolvedValue({
    budgets,
    spendAvailable: true,
    scopeReach: new Map(),
  });

  const router = GatewayBudgetTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: () => (procedure) => procedure,
  });

  return router.createCaller({
    app: {
      gateway: gatewayAppStub({
        budgetDecisions: budgetDecisionsStub({ listWithHealth, resolveScopeTargets }),
        projects: projectsStub({ tryGetOrganizationId: async () => ORG_ID }),
        assertOrganizationExists,
        resolveProviderLabels,
        listGroupTargets,
      }),
    },
    actor: () => ({ id: "usr_1" }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOrganizationExists.mockResolvedValue(undefined);
  resolveProviderLabels.mockResolvedValue(new Map());
  resolveScopeTargets.mockResolvedValue(
    new Map([
      [
        `ATTRIBUTED_USER:${ANCHOR_VK_ID}`,
        {
          kind: "ATTRIBUTED_USER",
          id: ANCHOR_VK_ID,
          name: "prod-openai",
          secondary: "lw_sk_ab…",
        },
      ],
      [
        `ATTRIBUTED_USER:${ANCHOR_PROJECT_ID}`,
        { kind: "ATTRIBUTED_USER", id: ANCHOR_PROJECT_ID, name: "gateway-demo" },
      ],
    ]),
  );
});

describe("GatewayBudgetTrpcApi.list for a per-person template", () => {
  describe("given a template the ledger has seen people under", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("carries the per-person standing onto the wire", async () => {
      const { budgets } = await callerFor([template()]).list({ organizationId: ORG_ID });

      expect(budgets[0]?.endUsersSeen).toBe(2);
      expect(budgets[0]?.endUsersOver).toBe(1);
    });
  });

  describe("given a template nobody has used yet", () => {
    /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
    it("reports zero seen and zero over", async () => {
      const { budgets } = await callerFor([
        template({ endUsersSeen: 0, endUsersOver: 0 }),
      ]).list({ organizationId: ORG_ID });

      expect(budgets[0]?.endUsersSeen).toBe(0);
      expect(budgets[0]?.endUsersOver).toBe(0);
    });
  });

  describe("given a template anchored on a virtual key", () => {
    /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
    it("names the virtual key the template anchors on", async () => {
      const { budgets } = await callerFor([template()]).list({ organizationId: ORG_ID });

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
      const { budgets } = await callerFor([template({ scopeId: ANCHOR_PROJECT_ID })]).list({
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
      const { budgets } = await callerFor([
        template({
          id: "bdg_project",
          scopeType: "PROJECT",
          scopeId: ANCHOR_PROJECT_ID,
          endUsersSeen: undefined,
          endUsersOver: undefined,
        }),
      ]).list({ organizationId: ORG_ID });

      expect(budgets[0]?.endUsersSeen).toBeNull();
      expect(budgets[0]?.endUsersOver).toBeNull();
    });
  });
});

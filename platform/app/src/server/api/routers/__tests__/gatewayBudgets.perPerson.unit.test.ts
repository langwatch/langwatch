/**
 * What the budgets list hands the UI for a per-person template.
 *
 * Two things the screen cannot render without: the standing (how many
 * people are over their own cap) and the Scope column's anchor name. The
 * batch scope resolver keys off `scopeType`, so a scope it does not know
 * about is dropped in silence and the column just goes blank; that is how
 * ATTRIBUTED_USER rows shipped nameless.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  nanoUsdToDecimalString,
  usdToNanoUsd,
} from "~/server/gateway/wireMoney";
import { createInnerTRPCContext } from "../../trpc";
import { gatewayBudgetsRouter } from "../gatewayBudgets";

const ORG_ID = "org_1";
const ANCHOR_VK_ID = "vk_anchor";
const ANCHOR_PROJECT_ID = "project_anchor";

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

const breakdown = vi.hoisted(() => vi.fn());

// The router takes the budget ledger from the App, so standing in for the
// store means standing in for `getApp()`.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    gateway: {
      budgets: {
        getSpendForBudgetsAcrossTenants: async () => [],
        getBucketSpendBreakdownForBudget: breakdown,
      },
      virtualKeySpend: undefined,
    },
  }),
}));

vi.mock("~/server/gateway/providerLabels", () => ({
  resolveProviderLabels: async () => new Map(),
  providerLabelFor: () => null,
}));

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
    limitUsd: new Prisma.Decimal("1.00"),
    spentUsd: new Prisma.Decimal("0.00"),
    timezone: null,
    providerKey: null,
    currentPeriodStartedAt: new Date(),
    resetsAt: new Date("2099-01-01T00:00:00Z"),
    lastResetAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "usr_1",
    ...overrides,
  };
}

function mockPrisma(budgets: Array<Record<string, unknown>>): PrismaClient {
  return {
    organization: { findUnique: async () => ({ id: ORG_ID }) },
    gatewayBudget: { findMany: async () => budgets },
    gatewayBudgetBucketBoundary: { findMany: async () => [] },
    project: {
      findMany: async (args: any) =>
        // Anchor resolution asks by id; tenant resolution asks by team.
        args?.where?.id
          ? [
              {
                id: ANCHOR_PROJECT_ID,
                name: "gateway-demo",
                slug: "gateway-demo",
              },
            ]
          : [{ id: "project_1" }],
    },
    virtualKey: {
      findMany: async (args: any) =>
        args?.where?.id
          ? [
              {
                id: ANCHOR_VK_ID,
                name: "prod-openai",
                displayPrefix: "lw_sk_ab",
                scopes: [],
              },
            ]
          : // Scope reach walks the active keys; none needed here.
            [],
    },
  } as unknown as PrismaClient;
}

function callerFor(budgets: Array<Record<string, unknown>>) {
  return gatewayBudgetsRouter.createCaller({
    ...createInnerTRPCContext({
      session: { user: { id: "usr_1" }, expires: "1" },
    }),
    prisma: mockPrisma(budgets),
  } as any);
}

/** A bucket's spend, as both wire units, derived from one USD amount. */
function bucketSpend(usd: string) {
  const spentNanoUsd = Number(usdToNanoUsd(usd));
  return { spentNanoUsd, spentUsd: nanoUsdToDecimalString(spentNanoUsd) };
}

beforeEach(() => {
  vi.clearAllMocks();
  breakdown.mockResolvedValue([
    { scopeId: `${ANCHOR_VK_ID}:a`, ...bucketSpend("1.500000") },
    { scopeId: `${ANCHOR_VK_ID}:b`, ...bucketSpend("0.200000") },
  ]);
});

describe("gatewayBudgets.list for a per-person template", () => {
  /** @scenario "A per-person template counts the people it has seen and the people over cap" */
  it("carries the per-person standing onto the wire", async () => {
    const { budgets } = await callerFor([template()]).list({
      organizationId: ORG_ID,
    });

    expect(budgets[0]?.endUsersSeen).toBe(2);
    expect(budgets[0]?.endUsersOver).toBe(1);
  });

  /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
  it("reports zero seen and zero over for a template nobody has used", async () => {
    breakdown.mockResolvedValue([]);

    const { budgets } = await callerFor([template()]).list({
      organizationId: ORG_ID,
    });

    expect(budgets[0]?.endUsersSeen).toBe(0);
    expect(budgets[0]?.endUsersOver).toBe(0);
  });

  /** @scenario "Budget list Scope column resolves target name with VK link" */
  it("names the virtual key a template anchors on", async () => {
    const { budgets } = await callerFor([template()]).list({
      organizationId: ORG_ID,
    });

    expect(budgets[0]?.scopeTarget).toMatchObject({
      kind: "ATTRIBUTED_USER",
      id: ANCHOR_VK_ID,
      name: "prod-openai",
      secondary: "lw_sk_ab…",
    });
  });

  /** @scenario "Budget list Scope column resolves target name with VK link" */
  it("names the project a template anchors on", async () => {
    const { budgets } = await callerFor([
      template({ scopeId: ANCHOR_PROJECT_ID }),
    ]).list({ organizationId: ORG_ID });

    expect(budgets[0]?.scopeTarget).toMatchObject({
      kind: "ATTRIBUTED_USER",
      id: ANCHOR_PROJECT_ID,
      name: "gateway-demo",
    });
  });

  /** @scenario "A per-person template counts the people it has seen and the people over cap" */
  it("leaves the standing null on scopes that are not templates", async () => {
    const { budgets } = await callerFor([
      template({
        id: "bdg_project",
        scopeType: "PROJECT",
        scopeId: ANCHOR_PROJECT_ID,
      }),
    ]).list({ organizationId: ORG_ID });

    expect(budgets[0]?.endUsersSeen).toBeNull();
    expect(budgets[0]?.endUsersOver).toBeNull();
    expect(breakdown).not.toHaveBeenCalled();
  });
});

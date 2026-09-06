// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The spender breakdown through the real router, against real stores: the
 * panel's read shows who spent the pulled money, and it stays behind BOTH
 * screens' permissions.
 *
 * The permission half is the part that cannot be proven at unit level: the
 * labels are the People screen's data, and a custom role holding only the
 * cost permission (`governanceCost:view`) is refused that screen — so this
 * breakdown must refuse it too, while the cost lanes keep answering for it.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   Rule: Pulled spend says who spent it, in the words the identity screen uses
 * Decision: ADR-128 §14 / ADR-129.
 */
import { FREE_PLAN } from "@ee/licensing/constants";
import type { PlanInfo } from "@ee/licensing/planInfo";
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { DISCOVERED_PERSON_KIND } from "../../repositories/governanceIdentity.repository";
import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "../../projections/governanceCostRollup.constants";
import {
  GovernanceCostRollupClickHouseRepository,
  type GovernanceCostRollupRow,
} from "../../services/governanceCostRollup.clickhouse.repository";
import { ensureHiddenGovernanceProject } from "../../services/governanceProject.service";

const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

const NANO = 1_000_000_000;

describe("governanceCost.spenders — router integration", () => {
  const ns = `gcs-${nanoid(8)}`;

  let ch: ClickHouseClient;
  let organizationId: string;
  let tenantId: string;
  let adminUserId: string;
  let costOnlyUserId: string;
  /** A recent day, safely inside every windowDays the tests use. */
  const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

  /** One rollup cell, priced in USD, on the pulled lane unless said otherwise. */
  function cell(
    overrides: Partial<GovernanceCostRollupRow>,
  ): GovernanceCostRollupRow {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      TenantId: tenantId,
      Day: day,
      CostSource: GOVERNANCE_COST_SOURCE.PULLED,
      IngestionSourceId: `src-${ns}`,
      Provider: "openai_admin",
      Model: "openai/gpt-5-mini",
      AgentId: "",
      CurrencyCode: "USD",
      RawActorId: "",
      OrganizationId: organizationId,
      ExactOrEstimate: "exact",
      AmountNanoUsd: 1 * NANO,
      AmountNanoMinor: 1 * NANO,
      TokensInput: 0,
      TokensOutput: 0,
      TokensCacheRead: 0,
      TokensCacheWrite: 0,
      RequestCount: 1,
      RevisionCount: 0,
      PreviousAmountNanoUsd: null,
      RevisedAt: null,
      LastObservedAt: nowSeconds,
      PulledItemsJson: "{}",
      Version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      AppliedEventIds: [],
      CreatedAt: nowSeconds,
      LastEventOccurredAt: Date.now(),
      EventTimestamp: Date.now(),
      ...overrides,
    };
  }

  beforeAll(async () => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
    const costRollup = new GovernanceCostRollupClickHouseRepository(
      async () => ch,
    );

    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async () => enterprisePlan,
      }),
    });
    // The test app wires no ClickHouse; hand the router the real repository
    // the same way production's preset does — one instance, same reference.
    globalForApp.__langwatch_app.governance.costRollup = costRollup;

    const organization = await prisma.organization.create({
      data: { name: `Spender Org ${ns}`, slug: `--gcs-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: {
        name: `Spender Team ${ns}`,
        slug: `--gcs-team-${ns}`,
        organizationId,
      },
    });
    const govProject = await ensureHiddenGovernanceProject(
      prisma,
      organizationId,
    );
    tenantId = govProject.id;

    const principal = async (
      name: string,
      email: string,
      orgRole: OrganizationUserRole,
      teamRole: TeamUserRole,
      customRoleId?: string,
    ) => {
      const user = await prisma.user.create({ data: { name, email } });
      await prisma.organizationUser.create({
        data: { userId: user.id, organizationId, role: orgRole },
      });
      await prisma.teamUser.create({
        data: { userId: user.id, teamId: team.id, role: teamRole },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: user.id,
          role: customRoleId ? TeamUserRole.CUSTOM : teamRole,
          customRoleId: customRoleId ?? null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
      return user.id;
    };

    adminUserId = await principal(
      "Spender Admin",
      `gcs-admin-${ns}@example.com`,
      OrganizationUserRole.ADMIN,
      TeamUserRole.ADMIN,
    );
    // The finance-shaped delegation: the cost screen's own permission and
    // nothing of the identity screens.
    const costOnlyRole = await prisma.customRole.create({
      data: {
        organizationId,
        name: `Cost only ${ns}`,
        permissions: ["organization:view", "governanceCost:view"],
      },
    });
    costOnlyUserId = await principal(
      "Cost Only",
      `gcs-cost-${ns}@example.com`,
      OrganizationUserRole.MEMBER,
      TeamUserRole.MEMBER,
      costOnlyRole.id,
    );

    // A person discovery has seen, and their pulled spend: two priced cells
    // for ada, plus a GATEWAY cell under a different actor id that must never
    // leak into the pulled breakdown.
    await prisma.discoveredPerson.create({
      data: {
        organizationId,
        provider: "openai_admin",
        rawActorId: `u_ada_${ns}`,
        displayText: `ada-${ns}@acme.example`,
        kind: DISCOVERED_PERSON_KIND.PERSON,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const rollup = costRollup;
    await rollup.upsert(
      cell({ RawActorId: `u_ada_${ns}`, AmountNanoUsd: 3 * NANO }),
    );
    await rollup.upsert(
      cell({
        RawActorId: `u_ada_${ns}`,
        Model: "openai/gpt-5",
        AmountNanoUsd: 4 * NANO,
      }),
    );
    await rollup.upsert(
      cell({
        CostSource: GOVERNANCE_COST_SOURCE.GATEWAY,
        Provider: "openai",
        RawActorId: `gw_actor_${ns}`,
        AmountNanoUsd: 50 * NANO,
      }),
    );
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["discoveredPerson", { organizationId }],
      ["roleBinding", { organizationId }],
      ["customRole", { organizationId }],
      ["teamUser", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      ["project", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organization", { slug: `--gcs-${ns}` }],
      [
        "user",
        {
          email: {
            in: [
              `gcs-admin-${ns}@example.com`,
              `gcs-cost-${ns}@example.com`,
            ],
          },
        },
      ],
    ]);
    await resetApp();
  });

  function callerFor(userId: string) {
    const ctx = createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" } as never,
    });
    return appRouter.createCaller(ctx);
  }

  describe("given pulled cost recorded under a spender discovery has seen", () => {
    /** @scenario The cost screen shows who spent the pulled money */
    it("lists that spender with their window total, labeled with the display text", async () => {
      const caller = callerFor(adminUserId);
      const result = await caller.governanceCost.spenders({
        organizationId,
        windowDays: 30,
      });

      expect(result.unavailableReason).toBeNull();
      const ada = result.rows.find((r) => r.rawActorId === `u_ada_${ns}`);
      expect(ada?.label).toBe(`ada-${ns}@acme.example`);
      expect(ada?.amountUsd).toBe(7);
      // The gateway cell wrote 50 USD under its own actor on the same day
      // and must be nowhere in this breakdown — not as a row, not in a total.
      expect(
        result.rows.some((r) => r.rawActorId === `gw_actor_${ns}`),
      ).toBe(false);
      expect(result.rows.some((r) => (r.amountUsd ?? 0) >= 50)).toBe(false);
    });
  });

  describe("given a caller holding the cost permission but not the identity screen's", () => {
    /** @scenario The spender breakdown stays behind the identity screen's permission */
    it("refuses the breakdown while the cost lanes still answer", async () => {
      const caller = callerFor(costOnlyUserId);
      await expect(
        caller.governanceCost.spenders({ organizationId, windowDays: 30 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The same caller's cost permission still buys the figures.
      const summary = await caller.governanceCost.summary({
        organizationId,
        windowDays: 30,
      });
      expect(summary.unavailableReason).toBeNull();
    });
  });
});

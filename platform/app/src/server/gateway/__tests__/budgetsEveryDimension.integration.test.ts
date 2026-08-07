/**
 * @vitest-environment node
 *
 * Budgets on every dimension, against real Postgres + real ClickHouse.
 *
 * Covers the control-plane half of the initiative: which budgets apply to a
 * key (including per-member group budgets and provider filters), how
 * their spend is kept apart in the ledger, what the gateway bundle carries,
 * and the key create / revoke invariants around a key's own budget.
 *
 * Spec: specs/ai-gateway/gateway-budget-targeting.feature
 *       specs/ai-gateway/budgets.feature
 *       specs/ai-gateway/virtual-key-creation.feature
 *       specs/ai-gateway/provider-routing.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { GatewayBudgetService } from "../budget.service";
import {
  budgetAppliesToProvider,
  resolveApplicableBudgets,
} from "../budgetResolution.service";
import { GatewayConfigMaterialiser } from "../config.materialiser";
import { VirtualKeyRepository } from "../virtualKey.repository";
import { VirtualKeyService } from "../virtualKey.service";

const suffix = nanoid(8);
const ORG_ID = `org-nxn-${suffix}`;
const TEAM_ID = `team-nxn-${suffix}`;
const PROJECT_ID = `proj-nxn-${suffix}`;
const USER_ID = `usr-nxn-${suffix}`;
const OTHER_USER_ID = `usr-nxn-other-${suffix}`;
const GROUP_ID = `grp-nxn-${suffix}`;
const MP_OPENAI_ID = `mp-nxn-openai-${suffix}`;
const MP_ANTHROPIC_ID = `mp-nxn-anthropic-${suffix}`;
const VK_PERSONAL_ID = `vk_nxn_personal_${suffix}`;
const VK_SHARED_ID = `vk_nxn_shared_${suffix}`;
const BUDGET_GROUP_ID = `bdg-nxn-group-${suffix}`;
const BUDGET_PROJECT_ALL_ID = `bdg-nxn-proj-all-${suffix}`;
const BUDGET_PROJECT_OPENAI_ID = `bdg-nxn-proj-openai-${suffix}`;
// A second tenant whose group must not be budgetable from ORG_ID.
const FOREIGN_ORG_ID = `org-nxn-foreign-${suffix}`;
const FOREIGN_GROUP_ID = `grp-nxn-foreign-${suffix}`;

// Ids created by the tests themselves; the teardown only touches what was
// actually assigned so a failure before creation cannot widen a delete.
const createdVirtualKeyIds: string[] = [];

async function seedProviders() {
  for (const [id, provider] of [
    [MP_OPENAI_ID, "openai"],
    [MP_ANTHROPIC_ID, "anthropic"],
  ] as const) {
    await prisma.modelProvider.create({
      data: {
        id,
        name: provider,
        provider,
        enabled: true,
        organizationId: ORG_ID,
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
  }
}

describe("budgets on every dimension (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `NxN Org ${suffix}`, slug: `nxn-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `NxN Team ${suffix}`,
        slug: `nxn-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `NxN Project ${suffix}`,
        slug: `nxn-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `nxn-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@nxn.local`, name: "Member" },
    });
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `other-${suffix}@nxn.local`,
        name: "Other",
      },
    });
    await prisma.group.create({
      data: {
        id: GROUP_ID,
        organizationId: ORG_ID,
        name: `Engineering ${suffix}`,
        slug: `eng-${suffix}`,
        members: { create: [{ userId: USER_ID }] },
      },
    });
    await seedProviders();

    await prisma.virtualKey.create({
      data: {
        id: VK_PERSONAL_ID,
        organizationId: ORG_ID,
        name: "personal-key",
        hashedSecret: `hash-personal-${suffix}`,
        displayPrefix: "vk-lw-per",
        principalUserId: USER_ID,
        createdById: USER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_SHARED_ID,
        organizationId: ORG_ID,
        name: "shared-key",
        hashedSecret: `hash-shared-${suffix}`,
        displayPrefix: "vk-lw-shr",
        createdById: USER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });

    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_GROUP_ID,
        name: `Engineering per-member ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "GROUP",
        scopeId: GROUP_ID,
        window: "MONTH",
        limitUsd: "50.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_PROJECT_ALL_ID,
        name: `Project all providers ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
        window: "MONTH",
        limitUsd: "500.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_PROJECT_OPENAI_ID,
        name: `Project OpenAI only ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
        providerKey: MP_OPENAI_ID,
        window: "MONTH",
        limitUsd: "10.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }, 120_000);

  afterAll(async () => {
    // The CH rows are tenant-isolated by the nanoid project id, but the
    // shared container should not accrue a suite's worth of debits per
    // run. The totals table is a materialized-view target, so the source
    // delete does not cascade; both need the sweep.
    const ch = getTestClickHouseClient();
    if (ch) {
      await ch.command({
        query:
          "DELETE FROM gateway_budget_ledger_events WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: PROJECT_ID },
      });
      await ch.command({
        query:
          "DELETE FROM gateway_budget_scope_totals WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: PROJECT_ID },
      });
    }
    if (createdVirtualKeyIds.length > 0) {
      await prisma.gatewayBudget.deleteMany({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: { in: createdVirtualKeyIds },
        },
      });
      await prisma.virtualKey.deleteMany({
        where: { id: { in: createdVirtualKeyIds } },
      });
    }
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    // The cross-org test's tenant: refusals leave no budget rows behind,
    // and deleting the organization cascades its group.
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: FOREIGN_ORG_ID },
    });
    await prisma.organization.deleteMany({ where: { id: FOREIGN_ORG_ID } });
    await prisma.virtualKey.deleteMany({
      where: { id: { in: [VK_PERSONAL_ID, VK_SHARED_ID] } },
    });
    await prisma.groupMembership.deleteMany({ where: { groupId: GROUP_ID } });
    await prisma.group.deleteMany({ where: { id: GROUP_ID } });
    await prisma.modelProvider.deleteMany({
      where: { id: { in: [MP_OPENAI_ID, MP_ANTHROPIC_ID] } },
    });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 120_000);

  describe("given a GROUP budget on a group with members", () => {
    /** @scenario "A group budget gives each member their own allowance" */
    it("resolves a GROUP budget into that member's own bucket", async () => {
      const resolved = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
          virtualKeyId: VK_PERSONAL_ID,
          principalUserId: USER_ID,
        },
      });
      const group = resolved.find((r) => r.budget.id === BUDGET_GROUP_ID);
      expect(group).toBeDefined();
      expect(group!.bucketScopeId).toBe(`${GROUP_ID}:${USER_ID}`);
      expect(group!.principalUserId).toBe(USER_ID);
      expect(group!.groupId).toBe(GROUP_ID);
    });

    /** @scenario "A group budget does not apply to a key with no person behind it" */
    it("skips GROUP budgets for a key with no principal", async () => {
      const resolved = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
          virtualKeyId: VK_SHARED_ID,
          principalUserId: null,
        },
      });
      expect(resolved.map((r) => r.budget.id)).not.toContain(BUDGET_GROUP_ID);
    });

    /** @scenario "Leaving a group drops that member's allowance on the next resolve" */
    it("stops resolving the budget once the member leaves the group", async () => {
      await prisma.groupMembership.create({
        data: { userId: OTHER_USER_ID, groupId: GROUP_ID },
      });
      const joined = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          virtualKeyId: VK_SHARED_ID,
          principalUserId: OTHER_USER_ID,
        },
      });
      expect(joined.map((r) => r.budget.id)).toContain(BUDGET_GROUP_ID);

      await prisma.groupMembership.delete({
        where: { userId_groupId: { userId: OTHER_USER_ID, groupId: GROUP_ID } },
      });
      const left = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          virtualKeyId: VK_SHARED_ID,
          principalUserId: OTHER_USER_ID,
        },
      });
      expect(left.map((r) => r.budget.id)).not.toContain(BUDGET_GROUP_ID);
    });
  });

  describe("when creating a group budget", () => {
    /** @scenario "A group budget cannot be created where members' spend cannot be told apart" */
    it("refuses GROUP creation when no ClickHouse spend path is wired", async () => {
      // The same detection check() uses to pick ClickHouse over the PG
      // fallback: the repo the service was constructed with. Without it,
      // per-member buckets collapse into the single spentUsd figure and
      // every member would be capped at the group's combined spend.
      const service = GatewayBudgetService.create(prisma);
      await expect(
        service.create({
          organizationId: ORG_ID,
          scope: { kind: "GROUP", groupId: GROUP_ID },
          name: `No ledger ${suffix}`,
          window: "MONTH",
          limitUsd: "25.00",
          actorUserId: USER_ID,
        }),
      ).rejects.toMatchObject({
        // A limit of the deployment, not the admin's mistake — and the copy no
        // longer names the storage engine that cannot do it.
        code: "gateway_group_budget_unsupported",
        fault: "platform",
      });

      const rows = await prisma.gatewayBudget.findMany({
        where: { organizationId: ORG_ID, name: `No ledger ${suffix}` },
      });
      expect(rows).toHaveLength(0);
    });

    it("creates a GROUP budget when the ClickHouse spend path is wired, per member", async () => {
      const ch = getTestClickHouseClient();
      expect(ch).not.toBeNull();
      const chRepo = new GatewayBudgetClickHouseRepository(
        async () => ch as ClickHouseClient,
      );
      const service = GatewayBudgetService.create(prisma, chRepo);
      const row = await service.create({
        organizationId: ORG_ID,
        scope: { kind: "GROUP", groupId: GROUP_ID },
        name: `Ledgered ${suffix}`,
        window: "MONTH",
        limitUsd: "25.00",
        actorUserId: USER_ID,
      });
      expect(row.scopeType).toBe("GROUP");
      expect(row.scopeId).toBe(GROUP_ID);

      // The created budget rides the per-member cascade like any other
      // group budget.
      const resolved = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          virtualKeyId: VK_PERSONAL_ID,
          principalUserId: USER_ID,
        },
      });
      const bucket = resolved.find((r) => r.budget.id === row.id);
      expect(bucket).toBeDefined();
      expect(bucket!.bucketScopeId).toBe(`${GROUP_ID}:${USER_ID}`);
    });

    it("refuses a group from another organization", async () => {
      await prisma.organization.create({
        data: {
          id: FOREIGN_ORG_ID,
          name: `NxN Foreign ${suffix}`,
          slug: `nxn-foreign-${suffix}`,
        },
      });
      await prisma.group.create({
        data: {
          id: FOREIGN_GROUP_ID,
          organizationId: FOREIGN_ORG_ID,
          name: `Foreign Eng ${suffix}`,
          slug: `foreign-eng-${suffix}`,
        },
      });
      const ch = getTestClickHouseClient();
      const chRepo = new GatewayBudgetClickHouseRepository(
        async () => ch as ClickHouseClient,
      );
      const service = GatewayBudgetService.create(prisma, chRepo);
      await expect(
        service.create({
          organizationId: ORG_ID,
          scope: { kind: "GROUP", groupId: FOREIGN_GROUP_ID },
          name: `Cross tenant ${suffix}`,
          window: "MONTH",
          limitUsd: "25.00",
          actorUserId: USER_ID,
        }),
      ).rejects.toThrow(/does not belong to this organization/);
    });
  });

  describe("given a budget filtered to a single provider", () => {
    /** @scenario "A provider-filtered budget only counts spend sent to that provider" */
    it("matches only the provider it names", async () => {
      const openAiOnly = await prisma.gatewayBudget.findUniqueOrThrow({
        where: { id: BUDGET_PROJECT_OPENAI_ID },
      });
      const everything = await prisma.gatewayBudget.findUniqueOrThrow({
        where: { id: BUDGET_PROJECT_ALL_ID },
      });

      expect(budgetAppliesToProvider(openAiOnly, MP_OPENAI_ID)).toBe(true);
      expect(budgetAppliesToProvider(openAiOnly, MP_ANTHROPIC_ID)).toBe(false);
      // Unknown dispatch: an unfiltered budget still counts it, a filtered
      // one must not: attributing it would be a guess.
      expect(budgetAppliesToProvider(openAiOnly, null)).toBe(false);
      expect(budgetAppliesToProvider(everything, null)).toBe(true);
      expect(budgetAppliesToProvider(everything, MP_ANTHROPIC_ID)).toBe(true);
    });

    /** @scenario "Two budgets on the same target with different provider filters do not share spend" */
    /** @scenario "Spend is attributed to the provider that actually served the request" */
    it("keeps a filtered and an unfiltered budget on the same target apart", async () => {
      const ch = getTestClickHouseClient();
      expect(ch).not.toBeNull();
      const chRepo = new GatewayBudgetClickHouseRepository(
        async () => ch as ClickHouseClient,
      );

      const resolved = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
          virtualKeyId: VK_SHARED_ID,
        },
      });
      const filtered = resolved.find(
        (r) => r.budget.id === BUDGET_PROJECT_OPENAI_ID,
      )!;
      const unfiltered = resolved.find(
        (r) => r.budget.id === BUDGET_PROJECT_ALL_ID,
      )!;
      // Same target, different bucket: otherwise each would report the
      // other's spend.
      expect(filtered.bucketScopeId).not.toBe(unfiltered.bucketScopeId);

      const requestId = `req-${suffix}-anthropic`;
      await chRepo.insertDebit([
        {
          tenantId: PROJECT_ID,
          budgetId: unfiltered.budget.id,
          scope: "PROJECT",
          scopeId: unfiltered.bucketScopeId,
          window: "MONTH",
          virtualKeyId: VK_SHARED_ID,
          providerKey: MP_ANTHROPIC_ID,
          gatewayRequestId: requestId,
          amountNanoUsd: 250_000_000,
          tokensInput: 10,
          tokensOutput: 5,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "claude-sonnet-4",
          status: "SUCCESS",
          occurredAt: new Date(),
        },
      ]);

      const spends = await chRepo.getSpendForTargetsAcrossTenants(
        [PROJECT_ID],
        [filtered, unfiltered].map((r) => ({
          budgetId: r.budget.id,
          scope: r.budget.scopeType,
          scopeId: r.bucketScopeId,
          window: r.budget.window,
          match: "exact" as const,
        })),
      );
      const byId = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
      expect(Number(byId.get(BUDGET_PROJECT_ALL_ID))).toBeCloseTo(0.25, 4);
      expect(Number(byId.get(BUDGET_PROJECT_OPENAI_ID))).toBe(0);
    });
  });

  describe("when the gateway bundle materialises for a key", () => {
    // Restores run in afterEach, not at test tails: an assertion that
    // throws mid-test must not leak a mutated seed key or a leftover
    // provider into the next test's world and fail it for an unrelated
    // reason.
    afterEach(async () => {
      await prisma.virtualKey.update({
        where: { id: VK_PERSONAL_ID },
        data: { routingMode: "NONE" },
      });
      await prisma.virtualKey.update({
        where: { id: VK_SHARED_ID },
        data: { config: {} },
      });
      await prisma.modelProvider.deleteMany({
        where: { id: `mp-nxn-late-${suffix}` },
      });
    });

    /** @scenario "The gateway is told each budget's provider filter and per-member bucket" */
    it("ships provider_key, the group bucket and routing_mode", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_PERSONAL_ID, ORG_ID);
      const bundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise(vk!);

      const openAiBudget = bundle.budgets.find(
        (b) => b.id === BUDGET_PROJECT_OPENAI_ID,
      );
      expect(openAiBudget?.provider_key).toBe(MP_OPENAI_ID);
      const allBudget = bundle.budgets.find(
        (b) => b.id === BUDGET_PROJECT_ALL_ID,
      );
      expect(allBudget?.provider_key).toBeNull();

      const groupBudget = bundle.budgets.find((b) => b.id === BUDGET_GROUP_ID);
      expect(groupBudget?.scope).toBe("group");
      expect(groupBudget?.scope_id).toBe(`${GROUP_ID}:${USER_ID}`);
      expect(groupBudget?.principal_id).toBe(USER_ID);

      // Seeded keys predate the routing-mode split, so they carry the
      // column default rather than a migrated value.
      expect(bundle.routing_mode).toBe("none");
      expect(bundle.providers_allowed).toBeNull();
    });

    /** @scenario "A group budget gives each member their own allowance" */
    it("ships the member's own bucket spend, not the group total", async () => {
      const ch = getTestClickHouseClient();
      expect(ch).not.toBeNull();
      const chRepo = new GatewayBudgetClickHouseRepository(
        async () => ch as ClickHouseClient,
      );

      // Two members spend against the same GROUP budget row, each in their
      // own bucket.
      const debit = (member: string, amountNanoUsd: number) => ({
        tenantId: PROJECT_ID,
        budgetId: BUDGET_GROUP_ID,
        scope: "GROUP" as const,
        scopeId: `${GROUP_ID}:${member}`,
        window: "MONTH" as const,
        virtualKeyId: VK_PERSONAL_ID,
        providerKey: null,
        gatewayRequestId: `req-${suffix}-grp-${member}`,
        amountNanoUsd,
        tokensInput: 10,
        tokensOutput: 5,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        model: "gpt-5-mini",
        status: "SUCCESS" as const,
        occurredAt: new Date(),
      });
      // One insert per request: the repository enforces one
      // gateway_request_id per debit burst.
      await chRepo.insertDebit([debit(USER_ID, 10_000_000_000)]);
      await chRepo.insertDebit([debit(OTHER_USER_ID, 30_000_000_000)]);

      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_PERSONAL_ID, ORG_ID);
      const bundle = await new GatewayConfigMaterialiser(
        prisma,
        chRepo,
      ).materialise(vk!);

      const groupBudget = bundle.budgets.find((b) => b.id === BUDGET_GROUP_ID);
      // The gateway enforces spent >= limit on exactly this bucket. Reading
      // the raw budget row here would prefix-sum every member and cap this
      // member at what the whole group spent together, the shared pot
      // the per-member design exists to rule out.
      expect(groupBudget?.spent_micro_usd).toBe(10_000_000);
    });

    /** @scenario "Two budgets on the same target with different provider filters do not share spend" */
    it("keeps a provider-filtered group budget and its unfiltered sibling out of each other's totals", async () => {
      const ch = getTestClickHouseClient();
      expect(ch).not.toBeNull();
      const chRepo = new GatewayBudgetClickHouseRepository(
        async () => ch as ClickHouseClient,
      );

      const filteredBudgetId = `gb-nxn-grp-openai-${suffix}`;
      const filteredBudget = await prisma.gatewayBudget.create({
        data: {
          id: filteredBudgetId,
          name: `Engineering per-member OpenAI ${suffix}`,
          organizationId: ORG_ID,
          scopeType: "GROUP",
          scopeId: GROUP_ID,
          providerKey: MP_OPENAI_ID,
          window: "MONTH",
          limitUsd: "20.00",
          onBreach: "BLOCK",
          createdById: USER_ID,
          resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // The filtered budget's member bucket carries the provider suffix
      // BETWEEN nothing and AFTER the member id, the shape resolution
      // writes: group:member|provider:mp. A plain group-prefix read can
      // never match it, and an unanchored one would count it twice.
      await chRepo.insertDebit([
        {
          tenantId: PROJECT_ID,
          budgetId: filteredBudgetId,
          scope: "GROUP" as const,
          scopeId: `${GROUP_ID}:${USER_ID}|provider:${MP_OPENAI_ID}`,
          window: "MONTH" as const,
          virtualKeyId: VK_PERSONAL_ID,
          providerKey: MP_OPENAI_ID,
          gatewayRequestId: `req-${suffix}-grp-openai`,
          amountNanoUsd: 2_000_000_000,
          tokensInput: 10,
          tokensOutput: 5,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          status: "SUCCESS" as const,
          occurredAt: new Date(),
        },
      ]);

      const unfilteredBudget = await prisma.gatewayBudget.findUniqueOrThrow({
        where: { id: BUDGET_GROUP_ID },
      });
      const spends = await chRepo.getSpendForBudgetsAcrossTenants(
        [PROJECT_ID],
        [unfilteredBudget, filteredBudget],
      );
      const byId = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));

      // The filtered budget reads its own member buckets, not $0.
      expect(Number(byId.get(filteredBudgetId))).toBeCloseTo(2, 4);
      // The unfiltered sibling reads only suffix-less buckets: the two
      // members' 10 + 30 from the previous test, without absorbing the
      // filtered budget's 2.
      expect(Number(byId.get(BUDGET_GROUP_ID))).toBeCloseTo(40, 4);
    });

    /** @scenario "A key with no fallback is dispatched at most once" */
    /** @scenario "A key with no fallback attempts one provider and stops" */
    it("pins max_attempts to 1 when routing mode is NONE", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_PERSONAL_ID, ORG_ID);
      const bundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise(vk!);
      expect(bundle.fallback.max_attempts).toBe(1);

      await prisma.virtualKey.update({
        where: { id: VK_PERSONAL_ID },
        data: { routingMode: "FALLBACK_ALL" },
      });
      const fallbackVk = await repo.findById(VK_PERSONAL_ID, ORG_ID);
      const fallbackBundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise(fallbackVk!);
      expect(fallbackBundle.routing_mode).toBe("fallback_all");
      expect(fallbackBundle.fallback.max_attempts).toBeGreaterThan(1);
    });

    /** @scenario "An explicit provider list narrows what the key can reach" */
    /** @scenario "A key narrowed to one provider reaches only that provider" */
    it("filters providers[] by providers_allowed and keeps All open-ended", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const openVk = await repo.findById(VK_SHARED_ID, ORG_ID);
      const openBundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise(openVk!);
      expect(openBundle.providers_allowed).toBeNull();
      expect(openBundle.providers.map((p) => p.id).sort()).toEqual(
        [MP_ANTHROPIC_ID, MP_OPENAI_ID].sort(),
      );

      await prisma.virtualKey.update({
        where: { id: VK_SHARED_ID },
        data: { config: { providersAllowed: [MP_OPENAI_ID] } },
      });
      const narrowedVk = await repo.findById(VK_SHARED_ID, ORG_ID);
      const narrowedBundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise(narrowedVk!);
      expect(narrowedBundle.providers_allowed).toEqual([MP_OPENAI_ID]);
      expect(narrowedBundle.providers.map((p) => p.id)).toEqual([MP_OPENAI_ID]);
    });

    /** @scenario "Allowing all providers keeps future providers included" */
    /** @scenario "A key left open reaches providers added after it was created" */
    it("reaches a provider added after the key was created, unless narrowed", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const lateProviderId = `mp-nxn-late-${suffix}`;
      await prisma.modelProvider.create({
        data: {
          id: lateProviderId,
          name: "late-arrival",
          provider: "groq",
          enabled: true,
          organizationId: ORG_ID,
          scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
        },
      });

      // The key was created before this provider existed and was never
      // edited: leaving the list open has to mean future providers too,
      // otherwise "all" is only ever a snapshot of creation day.
      const openBundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise((await repo.findById(VK_SHARED_ID, ORG_ID))!);
      expect(openBundle.providers.map((p) => p.id)).toContain(lateProviderId);

      await prisma.virtualKey.update({
        where: { id: VK_SHARED_ID },
        data: { config: { providersAllowed: [MP_OPENAI_ID] } },
      });
      const narrowedBundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise((await repo.findById(VK_SHARED_ID, ORG_ID))!);
      expect(narrowedBundle.providers.map((p) => p.id)).not.toContain(
        lateProviderId,
      );
    });
  });

  describe("given a budget attached to the key itself", () => {
    /** @scenario "Creating a key with a budget creates both or neither" */
    it("creates the key and its budget in one transaction", async () => {
      const service = VirtualKeyService.create(prisma);
      const { virtualKey } = await service.create({
        organizationId: ORG_ID,
        name: `budgeted-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        budget: { limitUsd: "30.00", window: "DAY" },
      });
      createdVirtualKeyIds.push(virtualKey.id);

      const budget = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: virtualKey.id,
        },
      });
      expect(budget).not.toBeNull();
      expect(budget!.limitUsd.toString()).toBe("30");
      expect(budget!.window).toBe("DAY");
      expect(budget!.archivedAt).toBeNull();
      // The cap has to reach the gateway, not just the database.
      const bundle = await new GatewayConfigMaterialiser(
        prisma,
        null,
      ).materialise(
        (await new VirtualKeyRepository(prisma).findById(
          virtualKey.id,
          ORG_ID,
        ))!,
      );
      expect(bundle.budgets.map((b) => b.id)).toContain(budget!.id);
    });

    /** @scenario "Revoking a key retires its budget instead of deleting it" */
    it("archives the key's budget on revoke and keeps the row", async () => {
      const service = VirtualKeyService.create(prisma);
      const { virtualKey } = await service.create({
        organizationId: ORG_ID,
        name: `revoked-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        budget: { limitUsd: "5.00", window: "MONTH" },
      });
      createdVirtualKeyIds.push(virtualKey.id);

      await service.revoke({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });

      const budget = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: virtualKey.id,
        },
      });
      expect(budget).not.toBeNull();
      expect(budget!.archivedAt).not.toBeNull();
    });

    /** @scenario "Removing a key's budget from the drawer archives it" */
    it("archives rather than deletes when the budget field is cleared", async () => {
      const service = VirtualKeyService.create(prisma);
      const { virtualKey } = await service.create({
        organizationId: ORG_ID,
        name: `cleared-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        budget: { limitUsd: "9.00", window: "MONTH" },
      });
      createdVirtualKeyIds.push(virtualKey.id);

      await service.update({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        budget: null,
      });

      const budget = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: virtualKey.id,
        },
      });
      expect(budget!.archivedAt).not.toBeNull();
      const resolved = await resolveApplicableBudgets({
        client: prisma,
        target: {
          organizationId: ORG_ID,
          virtualKeyId: virtualKey.id,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        },
      });
      expect(resolved.map((r) => r.budget.id)).not.toContain(budget!.id);
    });
  });

  describe("given a team budget and a key scoped to that team", () => {
    /** @scenario "A team budget reaches a team-scoped key's traffic" */
    it("resolves the team budget even when the key's traces land on another team", async () => {
      const ownerTeamId = `team-nxn-owner-${suffix}`;
      const ownerBudgetId = `budget-nxn-owner-${suffix}`;
      const ownerKeyId = `vk_nxn_owner_${suffix}`;
      // Cleanup runs whatever happens: this leaves an ACTIVE key behind, and
      // every later reachability assertion reads the organization's active
      // keys, so one failure here would cascade into unrelated ones.
      try {
        await prisma.team.create({
          data: {
            id: ownerTeamId,
            name: `Owner ${suffix}`,
            slug: `owner-${suffix}`,
            organizationId: ORG_ID,
          },
        });
        await prisma.gatewayBudget.create({
          data: {
            id: ownerBudgetId,
            name: `Owner team cap ${suffix}`,
            organizationId: ORG_ID,
            scopeType: "TEAM",
            scopeId: ownerTeamId,
            window: "MONTH",
            limitUsd: "25.00",
            onBreach: "BLOCK",
            createdById: USER_ID,
            resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.virtualKey.create({
          data: {
            id: ownerKeyId,
            organizationId: ORG_ID,
            name: `owner-key-${suffix}`,
            hashedSecret: `hash-owner-${suffix}`,
            displayPrefix: "vk-lw-own",
            createdById: USER_ID,
            scopes: { create: [{ scopeType: "TEAM", scopeId: ownerTeamId }] },
          },
        });

        // teamId is the team the key's traces land in, which for a key not
        // scoped to exactly one project is the governance team, never the
        // team that owns the key. Passing a different team here is the whole
        // point: the budget must still resolve, from the key's own scope.
        const resolved = await resolveApplicableBudgets({
          client: prisma,
          target: {
            organizationId: ORG_ID,
            virtualKeyId: ownerKeyId,
            teamId: TEAM_ID,
            projectId: PROJECT_ID,
          },
        });
        expect(resolved.map((r) => r.budget.id)).toContain(ownerBudgetId);
      } finally {
        await prisma.virtualKeyScope.deleteMany({
          where: { virtualKeyId: ownerKeyId },
        });
        await prisma.virtualKey.deleteMany({ where: { id: ownerKeyId } });
        await prisma.gatewayBudget.deleteMany({ where: { id: ownerBudgetId } });
        await prisma.team.deleteMany({ where: { id: ownerTeamId } });
      }
    });
  });

  describe("when configuring a key's routing and providers", () => {
    /** @scenario "A key cannot be pointed at a provider it cannot reach" */
    /** @scenario "A key cannot name a provider outside its reach" */
    it("rejects a provider allowlist outside the key's scope graph", async () => {
      const otherOrgProvider = `mp-nxn-foreign-${suffix}`;
      // Exists in the org, scoped to a team the key has no reach into.
      const strangerTeamId = `team-nxn-stranger-${suffix}`;
      await prisma.team.create({
        data: {
          id: strangerTeamId,
          name: `Stranger ${suffix}`,
          slug: `stranger-${suffix}`,
          organizationId: ORG_ID,
        },
      });
      await prisma.modelProvider.create({
        data: {
          id: otherOrgProvider,
          name: "unreachable",
          provider: "openai",
          enabled: true,
          organizationId: ORG_ID,
          scopes: {
            create: [{ scopeType: "TEAM", scopeId: strangerTeamId }],
          },
        },
      });
      const service = VirtualKeyService.create(prisma);
      await expect(
        service.create({
          organizationId: ORG_ID,
          name: `bad-providers-${suffix}`,
          actorUserId: USER_ID,
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
          config: { providersAllowed: [otherOrgProvider] },
        }),
      ).rejects.toThrow(/providers_not_in_scope/);
      await prisma.modelProvider.deleteMany({
        where: { id: otherOrgProvider },
      });
      await prisma.team.deleteMany({ where: { id: strangerTeamId } });
    });

    /** @scenario "Unticking every provider is refused rather than saved" */
    /** @scenario "A key cannot be saved with no providers at all" */
    it("rejects an empty provider allowlist", async () => {
      const service = VirtualKeyService.create(prisma);
      await expect(
        service.create({
          organizationId: ORG_ID,
          name: `empty-providers-${suffix}`,
          actorUserId: USER_ID,
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
          config: { providersAllowed: [] },
        }),
      ).rejects.toThrow(/providers_allowed_empty/);
    });

    /** @scenario "A new key defaults to no fallback" */
    it("defaults a newly created key to routing mode NONE", async () => {
      const service = VirtualKeyService.create(prisma);
      const { virtualKey } = await service.create({
        organizationId: ORG_ID,
        name: `default-routing-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      });
      createdVirtualKeyIds.push(virtualKey.id);
      expect(virtualKey.routingMode).toBe("NONE");
    });

    /** @scenario "Routing mode and routing policy cannot contradict each other" */
    it("refuses POLICY without a policy and NONE with one", async () => {
      const service = VirtualKeyService.create(prisma);
      await expect(
        service.create({
          organizationId: ORG_ID,
          name: `policy-missing-${suffix}`,
          actorUserId: USER_ID,
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
          routingMode: "POLICY",
        }),
      ).rejects.toThrow(/routing_policy_required/);

      const policy = await prisma.routingPolicy.create({
        data: {
          id: `rp-nxn-${suffix}`,
          organizationId: ORG_ID,
          name: `Policy ${suffix}`,
          modelProviderIds: [MP_OPENAI_ID],
          createdById: USER_ID,
        },
      });
      await expect(
        service.create({
          organizationId: ORG_ID,
          name: `policy-conflict-${suffix}`,
          actorUserId: USER_ID,
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
          routingMode: "NONE",
          routingPolicyId: policy.id,
        }),
      ).rejects.toThrow(/routing_policy_conflict/);
      await prisma.routingPolicy.deleteMany({ where: { id: policy.id } });
    });
  });
});

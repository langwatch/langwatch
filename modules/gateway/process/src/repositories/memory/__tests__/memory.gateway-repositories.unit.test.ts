import type { GatewayVirtualKeyRecord } from "@langwatch/gateway-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryGatewayAuditRepository } from "../memory.gateway-audit.repository.ts";
import { MemoryGatewayBudgetChangeDedupeRepository } from "../memory.gateway-budget-change-dedupe.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../memory.gateway-change-event.repository.ts";
import { MemoryGatewayKeyBudgetRepository } from "../memory.gateway-key-budget.repository.ts";
import { MemoryGatewayOrganizationDirectoryRepository } from "../memory.gateway-organization-directory.repository.ts";
import { MemoryGatewayProviderLabelRepository } from "../memory.gateway-provider-label.repository.ts";
import { MemoryGatewaySpendScopeRepository } from "../memory.gateway-spend-scope.repository.ts";
import { MemoryGatewayTransactionRepository } from "../memory.gateway-transaction.repository.ts";
import { MemoryVirtualKeyDirectBudgetRepository } from "../memory.gateway-virtual-key-direct-budget.repository.ts";
import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
  memoryGatewayModelProvider,
} from "../memory.gateway.store.ts";

const ORG = "org_1";
const KEY = "vk_1";
const fields = {
  name: "Key budget",
  window: "MONTH" as const,
  limitUsd: "12.5",
  onBreach: "BLOCK" as const,
  timezone: null,
};

/** A complete key row, external id `ext_1`, as the memory store holds one. */
function virtualKey(input: { id: string; organizationId: string }): GatewayVirtualKeyRecord {
  const now = nowInstant();
  return {
    ...input,
    name: input.id,
    description: null,
    status: "ACTIVE",
    purpose: "USER",
    externalId: "ext_1",
    metadata: {},
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "hashed",
    displayPrefix: "lw_vk_",
    principalUserId: null,
    traceProjectId: null,
    config: {},
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
    createdById: "usr_1",
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [{ scopeType: "ORGANIZATION", scopeId: input.organizationId }],
    principalUser: null,
    routingPolicy: null,
  };
}

function keyBudgetsOver(store = MemoryGatewayStore.create()) {
  return { store, keyBudgets: MemoryGatewayKeyBudgetRepository.create(store) };
}

describe("memory gateway repositories", () => {
  describe("given a key drawer's budget", () => {
    it("reads it back as drawer-managed, scoped to the key, and directly targeting it", async () => {
      const { store, keyBudgets } = keyBudgetsOver();
      const created = await keyBudgets.createForKey({
        organizationId: ORG,
        virtualKeyId: KEY,
        createdById: "usr_1",
        resetsAt: nowInstant(),
        fields,
      });

      expect(
        await keyBudgets.findDrawerManaged({ organizationId: ORG, virtualKeyId: KEY }),
      ).toEqual(created);
      expect(
        await keyBudgets.findActiveForKey({
          organizationId: ORG,
          virtualKeyId: KEY,
          scope: "scopedToKey",
        }),
      ).toEqual([created]);
      expect(
        await MemoryVirtualKeyDirectBudgetRepository.create(store).findBudgetsTargetingKeys({
          organizationId: ORG,
          virtualKeyIds: [KEY],
        }),
      ).toEqual([created]);
      expect(created.limitUsd.toFixed(2)).toBe("12.50");
    });

    it("drops it from every read once archived", async () => {
      const { store, keyBudgets } = keyBudgetsOver();
      const created = await keyBudgets.createForKey({
        organizationId: ORG,
        virtualKeyId: KEY,
        createdById: "usr_1",
        resetsAt: nowInstant(),
        fields,
      });

      await keyBudgets.archive({ id: created.id, archivedAt: nowInstant() });

      expect(
        await keyBudgets.findDrawerManaged({ organizationId: ORG, virtualKeyId: KEY }),
      ).toBeNull();
      expect(
        await MemoryVirtualKeyDirectBudgetRepository.create(store).findBudgetsTargetingKeys({
          organizationId: ORG,
          virtualKeyIds: [KEY],
        }),
      ).toEqual([]);
    });

    it("refuses to update a budget it does not hold", async () => {
      const { keyBudgets } = keyBudgetsOver();

      await expect(keyBudgets.updateForKey({ id: "missing", fields })).rejects.toThrow("missing");
    });
  });

  describe("when a transaction's work throws", () => {
    it("leaves the shared rows as they were", async () => {
      const { store, keyBudgets } = keyBudgetsOver();
      const transactions = MemoryGatewayTransactionRepository.create(store);

      await expect(
        transactions.run(async () => {
          await keyBudgets.createForKey({
            organizationId: ORG,
            virtualKeyId: KEY,
            createdById: "usr_1",
            resetsAt: nowInstant(),
            fields,
          });
          throw new Error("rolled back");
        }),
      ).rejects.toThrow("rolled back");

      expect(
        await keyBudgets.findDrawerManaged({ organizationId: ORG, virtualKeyId: KEY }),
      ).toBeNull();
    });
  });

  describe("when events are appended to the change feed", () => {
    it("answers one organization's events after a revision, oldest first, within the limit", async () => {
      const changes = MemoryGatewayChangeEventsRepository.create();
      const first = await changes.append({
        organizationId: ORG,
        kind: "VK_CREATED",
        virtualKeyId: KEY,
      });
      await changes.append({ organizationId: "org_2", kind: "BUDGET_CREATED", budgetId: "b_1" });
      const third = await changes.append({
        organizationId: ORG,
        kind: "VK_ROTATED",
        virtualKeyId: KEY,
      });

      const page = await changes.since(ORG, 0n, 1);

      expect(page.events.map((event) => event.revision)).toEqual([first.revision]);
      expect(page.currentRevision).toBe(first.revision);
      expect(await changes.currentRevision(ORG)).toBe(third.revision);
      expect(await changes.since(ORG, third.revision)).toEqual({
        currentRevision: third.revision,
        events: [],
      });
      expect(await changes.currentRevision("org_none")).toBe(0n);
    });
  });

  it("keeps every audit entry in the order it was written", async () => {
    const store = MemoryGatewayStore.create();
    const audit = MemoryGatewayAuditRepository.create(store);
    await audit.append({
      organizationId: ORG,
      actorUserId: "usr_1",
      action: "gateway.budget.created",
      targetKind: "budget",
      targetId: "b_1",
    });

    expect(store.auditEntries).toEqual([
      expect.objectContaining({ action: "gateway.budget.created", projectId: null }),
    ]);
  });

  it("resolves external ids to the organization's own key ids only", async () => {
    const store = MemoryGatewayStore.create();
    store.virtualKeys.set("vk_a", virtualKey({ id: "vk_a", organizationId: ORG }));
    store.virtualKeys.set("vk_b", virtualKey({ id: "vk_b", organizationId: "org_2" }));

    expect(
      await MemoryGatewaySpendScopeRepository.create(store).findVirtualKeyIdsForExternalIds({
        organizationId: ORG,
        externalIds: ["ext_1"],
      }),
    ).toEqual(["vk_a"]);
  });

  it("labels a provider by its name, falling back to its provider", async () => {
    const store = MemoryGatewayStore.create({
      modelProviders: [
        memoryGatewayModelProvider({
          id: "mp_1",
          name: "Team OpenAI",
          provider: "openai",
          organizationId: ORG,
        }),
        memoryGatewayModelProvider({
          id: "mp_2",
          name: "",
          provider: "anthropic",
          organizationId: ORG,
        }),
      ],
    });

    const labels = await MemoryGatewayProviderLabelRepository.create(store).resolveProviderLabels([
      { providerKey: "mp_1" },
      { providerKey: "mp_2" },
      { providerKey: null },
    ]);

    expect([...labels]).toEqual([
      ["mp_1", "Team OpenAI"],
      ["mp_2", "anthropic"],
    ]);
  });

  it("lists an organization's groups by name with their sizes", async () => {
    const store = MemoryGatewayStore.create({
      groups: [
        { id: "g_b", organizationId: ORG, name: "Beta" },
        { id: "g_a", organizationId: ORG, name: "Alpha" },
        { id: "g_x", organizationId: "org_2", name: "Other" },
      ],
      groupMemberships: [
        { groupId: "g_b", userId: "u_1" },
        { groupId: "g_b", userId: "u_2" },
      ],
    });
    const directory = MemoryGatewayOrganizationDirectoryRepository.create(store);

    expect(await directory.findGroupTargets(ORG)).toEqual([
      { id: "g_a", name: "Alpha", memberCount: 0 },
      { id: "g_b", name: "Beta", memberCount: 2 },
    ]);
    expect([
      ...(await directory.groupMemberCounts([
        { scopeType: "GROUP", scopeId: "g_b" },
        { scopeType: "TEAM", scopeId: "g_a" },
      ])),
    ]).toEqual([["g_b", 2]]);
  });

  it("claims a project's dedupe window once until it lapses", async () => {
    const dedupe = MemoryGatewayBudgetChangeDedupeRepository.create();

    expect(await dedupe.claimWindow({ projectId: "p_1", windowSeconds: 60 })).toBe(true);
    expect(await dedupe.claimWindow({ projectId: "p_1", windowSeconds: 60 })).toBe(false);
    expect(await dedupe.claimWindow({ projectId: "p_2", windowSeconds: 60 })).toBe(true);
  });

  it("renders a decimal string exactly at any precision up to six places", () => {
    expect(memoryGatewayDecimal("0.0000015").toFixed(6)).toBe("0.000002");
    expect(memoryGatewayDecimal("-3.5").toFixed(0)).toBe("-4");
    expect(memoryGatewayDecimal("10").toFixed(2)).toBe("10.00");
    expect(memoryGatewayDecimal("12.500").toString()).toBe("12.5");
    expect(memoryGatewayDecimal("100").toString()).toBe("100");
  });
});

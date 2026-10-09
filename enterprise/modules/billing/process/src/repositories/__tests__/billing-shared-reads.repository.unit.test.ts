/**
 * @see enterprise/modules/billing/specs/billing.feature
 */
import { PROJECT_KIND } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillingOrganizationRepository } from "../memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingGatewaySpendRepository } from "../memory/memory.billing-gateway-spend.repository.ts";
import { MemoryBillingProjectDirectoryRepository } from "../memory/memory.billing-project-directory.repository.ts";
import { MemoryBillingStore } from "../memory/memory.billing.store.ts";
import { PrismaBillingOrganizationRepository } from "../prisma/prisma.billing-account-facts.repository.ts";
import { PrismaBillingProjectDirectoryRepository } from "../prisma/prisma.billing-project-directory.repository.ts";

const spend = (row: {
  tenantId: string;
  requestType?: string;
  status?: string;
  costNanoUsd: number;
  occurredAtMs?: number;
}) => ({ requestType: "instant_eval", status: "confirmed", occurredAtMs: 1_500, ...row });

describe("billing's shared reads", () => {
  describe("when billing sums spend from gateway's ledger", () => {
    /** @scenario "Billing sums one request type's confirmed spend from gateway's shared ledger" */
    it("counts only that request type's confirmed spend inside the window", async () => {
      const store = MemoryBillingStore.create();
      store.gatewaySpend.push(
        spend({ tenantId: "project-a", costNanoUsd: 100 }),
        spend({ tenantId: "project-b", costNanoUsd: 20 }),
        spend({ tenantId: "project-a", costNanoUsd: 7, status: "pending" }),
        spend({ tenantId: "project-a", costNanoUsd: 5, status: "failed" }),
        spend({ tenantId: "project-a", costNanoUsd: 3, requestType: "chat" }),
        spend({ tenantId: "project-a", costNanoUsd: 2, occurredAtMs: 2_000 }),
        spend({ tenantId: "project-other", costNanoUsd: 1 }),
      );
      const repository = MemoryBillingGatewaySpendRepository.create(store);

      await expect(
        repository.sumSpendNanoUsdByRequestType({
          tenantIds: ["project-a", "project-b"],
          requestType: "instant_eval",
          fromMs: 1_000,
          toMs: 2_000,
        }),
      ).resolves.toBe(120);
    });
  });

  describe("when billing lists an organization's projects", () => {
    /** @scenario "Billing lists an organization's projects from project's shared table" */
    it("spends over live projects and names every non-governance project, archived too", async () => {
      const store = MemoryBillingStore.create();
      const project = (id: string, extra: { archived?: boolean; governance?: boolean } = {}) => ({
        id,
        name: id.toUpperCase(),
        organizationId: "org-1",
        archived: false,
        governance: false,
        ...extra,
      });
      store.projects.push(
        project("zeta"),
        project("alpha", { archived: true }),
        project("gov", { governance: true }),
        { ...project("elsewhere"), organizationId: "org-2" },
      );
      const repository = MemoryBillingProjectDirectoryRepository.create(store);

      await expect(repository.findProjectIds({ organizationId: "org-1" })).resolves.toEqual([
        "zeta",
        "gov",
      ]);
      await expect(repository.findProjectsWithName({ organizationId: "org-1" })).resolves.toEqual([
        { id: "alpha", name: "ALPHA" },
        { id: "zeta", name: "ZETA" },
      ]);
    });

    /** @scenario "Billing lists an organization's projects from project's shared table" */
    it("asks project's table for the same sets", async () => {
      const queries: unknown[] = [];
      const prisma = prismaDouble({
        project: {
          findMany: async (args: unknown) => {
            queries.push(args);
            return [{ id: "zeta", name: "ZETA" }];
          },
        },
      });
      const repository = PrismaBillingProjectDirectoryRepository.create(prisma);

      await expect(repository.findProjectIds({ organizationId: "org-1" })).resolves.toEqual([
        "zeta",
      ]);
      await repository.findProjectsWithName({ organizationId: "org-1" });
      expect(queries).toEqual([
        { where: { archivedAt: null, team: { organizationId: "org-1" } }, select: { id: true } },
        {
          where: {
            team: { organizationId: "org-1" },
            kind: { not: PROJECT_KIND.INTERNAL_GOVERNANCE },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        },
      ]);
    });
  });

  describe("when billing reads organisations, memberships and people", () => {
    const STAMP = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);

    function storeWithPeople() {
      const store = MemoryBillingStore.create();
      for (const [id, selfHostedCustomer] of [
        ["org-a", false],
        ["org-b", true],
        ["org-c", false],
      ] as const) {
        store.organizations.set(id, {
          id,
          name: id.toUpperCase(),
          stripeCustomerId: null,
          pricingModel: "SEAT_EVENT",
          currency: null,
          license: null,
          selfHostedCustomer,
          teamIds: [],
          signupData: {},
          sentPlanLimitAlert: id === "org-a" ? STAMP : null,
        });
      }
      const person = (id: string, deactivated = false) =>
        store.users.set(id, { id, name: id, email: `${id}@acme.test`, deactivated });
      person("ann");
      person("bob");
      person("cat");
      person("dan", true);
      store.members.push(
        { organizationId: "org-a", userId: "ann", role: "ADMIN", disabled: false },
        { organizationId: "org-a", userId: "bob", role: "MEMBER", disabled: false },
        { organizationId: "org-a", userId: "cat", role: "MEMBER", disabled: true },
        { organizationId: "org-a", userId: "dan", role: "MEMBER", disabled: false },
      );
      return MemoryBillingOrganizationRepository.create(store);
    }

    /** @scenario "Billing names an organisation's administrators from the shared tables" */
    it("answers the name, the stamp and only the administrators", async () => {
      const organizations = storeWithPeople();

      await expect(organizations.findWithAdministrators("org-a")).resolves.toEqual({
        id: "org-a",
        name: "ORG-A",
        sentPlanLimitAlert: STAMP,
        administrators: [{ userId: "ann", name: "ann", email: "ann@acme.test" }],
      });
      await expect(organizations.findWithAdministrators("org-gone")).resolves.toBeNull();
    });

    /** @scenario "Billing names an organisation's administrators from the shared tables" */
    it("asks organization's and user's tables for the administrators", async () => {
      const queries: unknown[] = [];
      const prisma = prismaDouble({
        organization: {
          findUnique: async () => ({ id: "org-a", name: "ORG-A", sentPlanLimitAlert: null }),
        },
        organizationUser: {
          findMany: async (args: unknown) => {
            queries.push(args);
            return [{ userId: "ann" }];
          },
        },
        user: {
          findMany: async (args: unknown) => {
            queries.push(args);
            return [{ id: "ann", name: "Ann", email: "ann@acme.test" }];
          },
        },
      });

      await expect(
        PrismaBillingOrganizationRepository.create(prisma).findWithAdministrators("org-a"),
      ).resolves.toEqual({
        id: "org-a",
        name: "ORG-A",
        sentPlanLimitAlert: null,
        administrators: [{ userId: "ann", name: "Ann", email: "ann@acme.test" }],
      });
      expect(queries).toEqual([
        { where: { organizationId: "org-a", role: "ADMIN" }, select: { userId: true } },
        { where: { id: { in: ["ann"] } }, select: { id: true, name: true, email: true } },
      ]);
    });

    /** @scenario "Billing's lifecycle facts carry only the organisation's active members" */
    it("carries only members neither disabled nor deactivated", async () => {
      await expect(storeWithPeople().findActiveMemberIds("org-a")).resolves.toEqual(["ann", "bob"]);
    });

    /** @scenario "Billing pages organisation ids and lists connected customers from organization's shared table" */
    it("pages every id once in order and names only the connected customer", async () => {
      const organizations = storeWithPeople();

      const first = await organizations.listIds({ limit: 2 });
      const second = await organizations.listIds({ after: first.next ?? undefined, limit: 2 });

      expect([first, second]).toEqual([
        { ids: ["org-a", "org-b"], next: "org-b" },
        { ids: ["org-c"], next: null },
      ]);
      await expect(organizations.findSelfHostedCustomers()).resolves.toEqual([
        { organizationId: "org-b", organizationName: "ORG-B" },
      ]);
    });
  });
});

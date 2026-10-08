/**
 * @see enterprise/modules/billing/specs/billing.feature
 */
import { PROJECT_KIND } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { MemoryBillingGatewaySpendRepository } from "../memory/memory.billing-gateway-spend.repository.ts";
import { MemoryBillingProjectDirectoryRepository } from "../memory/memory.billing-project-directory.repository.ts";
import { MemoryBillingStore } from "../memory/memory.billing.store.ts";
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
});

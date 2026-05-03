import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { guardProjectId } from "../dbMultiTenancyProtection";

/**
 * Regression tests for the multitenancy guard — specifically its exempt
 * list. The guard rejects any findMany/findFirst without a projectId in
 * the WHERE clause, which is correct for project-scoped models but
 * catastrophic for org-scoped ones (silently throws inside every tx,
 * rolling back the whole mutation).
 *
 * Lane B iter 32 (commit 88a66af6d) added 4 org-scoped gateway models
 * to the exempt list after the bug surfaced on the live budgets page.
 * These tests lock that in.
 */

async function runGuard(params: Partial<Prisma.MiddlewareParams> & {
  model: string;
  action: Prisma.MiddlewareParams["action"];
  args: Prisma.MiddlewareParams["args"];
}): Promise<unknown> {
  const next = vi.fn(async () => "ok");
  return guardProjectId(
    {
      dataPath: [],
      runInTransaction: false,
      ...params,
    } as Prisma.MiddlewareParams,
    next,
  );
}

describe("guardProjectId — exempt org-scoped gateway models", () => {
  describe("findMany on GatewayBudget with only organizationId filter", () => {
    it("does NOT throw (org-scoped; projectId is not applicable)", async () => {
      await expect(
        runGuard({
          model: "GatewayBudget",
          action: "findMany",
          args: { where: { organizationId: "org_01", archivedAt: null } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("findMany on GatewayBudgetLedger with only budgetId filter", () => {
    it("does NOT throw (ledger descends from VirtualKey.projectId via virtualKeyId)", async () => {
      await expect(
        runGuard({
          model: "GatewayBudgetLedger",
          action: "findMany",
          args: { where: { budgetId: "b_01" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("create on GatewayChangeEvent without projectId in data", () => {
    it("does NOT throw — change-events allow null projectId for org-wide mutations", async () => {
      await expect(
        runGuard({
          model: "GatewayChangeEvent",
          action: "create",
          args: {
            data: {
              organizationId: "org_01",
              kind: "BUDGET_CREATED",
              budgetId: "b_01",
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("createMany on VirtualKeyProviderCredential without projectId", () => {
    it("does NOT throw — join table, projectId reachable via parent VK", async () => {
      // This path is hit on every VK create + every update that changes the
      // provider chain (see virtualKey.repository.replaceProviderChain).
      await expect(
        runGuard({
          model: "VirtualKeyProviderCredential",
          action: "createMany",
          args: {
            data: [
              {
                virtualKeyId: "vk_01",
                providerCredentialId: "gpc_01",
                priority: 0,
              },
            ],
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("deleteMany on VirtualKeyProviderCredential by virtualKeyId", () => {
    it("does NOT throw — same join-table rationale", async () => {
      await expect(
        runGuard({
          model: "VirtualKeyProviderCredential",
          action: "deleteMany",
          args: { where: { virtualKeyId: "vk_01" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("findMany on GatewayCacheRule with only organizationId filter", () => {
    it("does NOT throw (org-scoped; cache rules apply across every VK in the org)", async () => {
      await expect(
        runGuard({
          model: "GatewayCacheRule",
          action: "findMany",
          args: { where: { organizationId: "org_01", archivedAt: null } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("findFirst on RoutingPolicy with org-scoped filter", () => {
    // Regression: /api/auth/cli/exchange → approveDeviceCode →
    // PersonalVirtualKeyService.ensureDefault → RoutingPolicyService.
    // resolveDefaultForUser threw "requires projectId" inside the
    // device-flow approval handler, blocking every CLI dogfood. Caught
    // by @ai_gateway_andre during e2e dogfood on :5660.
    it("does NOT throw (org-scoped; (organizationId, scope, scopeId) is the natural key)", async () => {
      await expect(
        runGuard({
          model: "RoutingPolicy",
          action: "findFirst",
          args: {
            where: {
              organizationId: "org_01",
              scope: "team",
              scopeId: "team_01",
              isDefault: true,
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("create on RoutingPolicy without projectId in data", () => {
    it("does NOT throw (org-scoped; admin-defined templates carry organizationId+scope)", async () => {
      await expect(
        runGuard({
          model: "RoutingPolicy",
          action: "create",
          args: {
            data: {
              organizationId: "org_01",
              scope: "organization",
              scopeId: "org_01",
              name: "developer-default",
              providerCredentialIds: [],
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("create on GatewayCacheRule without projectId in data", () => {
    it("does NOT throw — cache rules carry organizationId, never projectId", async () => {
      await expect(
        runGuard({
          model: "GatewayCacheRule",
          action: "create",
          args: {
            data: {
              organizationId: "org_01",
              name: "force-cache-on-enterprise",
              priority: 200,
              matchers: { vk_tags: ["tier=enterprise"] },
              action: { mode: "force", ttl: 300 },
              modeEnum: "FORCE",
              createdById: "usr_01",
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });
});

describe("guardProjectId — project-scoped gateway models still guarded", () => {
  describe("findMany on VirtualKey WITHOUT projectId in where", () => {
    it("STILL throws — VirtualKey is project-scoped (regression guard)", async () => {
      await expect(
        runGuard({
          model: "VirtualKey",
          action: "findMany",
          args: { where: { status: "ACTIVE" } },
        }),
      ).rejects.toThrow(/requires a 'projectId'/);
    });
  });

  describe("findMany on VirtualKey WITH projectId in where", () => {
    it("does NOT throw (normal project-scoped query)", async () => {
      await expect(
        runGuard({
          model: "VirtualKey",
          action: "findMany",
          args: { where: { projectId: "proj_01", status: "ACTIVE" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("create on GatewayProviderCredential WITHOUT projectId in data", () => {
    it("STILL throws — provider credentials are project-scoped", async () => {
      await expect(
        runGuard({
          model: "GatewayProviderCredential",
          action: "create",
          args: {
            data: { modelProviderId: "mp_01", slot: "primary" },
          },
        }),
      ).rejects.toThrow(/requires a 'projectId'/);
    });
  });
});

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

  // VirtualKeyProviderCredential coverage retired in iter 110: the
  // binding join table was dropped; chain ordering moved to
  // RoutingPolicy.modelProviderIds.

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

describe("guardProjectId — org-scoped VirtualKey still guarded", () => {
  describe("findMany on VirtualKey WITHOUT any tenancy predicate", () => {
    it("STILL throws — VirtualKey requires organizationId/id/scope (regression guard)", async () => {
      await expect(
        runGuard({
          model: "VirtualKey",
          action: "findMany",
          args: { where: { status: "ACTIVE" } },
        }),
      ).rejects.toThrow(/requires an 'organizationId'/);
    });
  });

  describe("findMany on VirtualKey WITH organizationId in where", () => {
    it("does NOT throw (canonical org-scoped query)", async () => {
      await expect(
        runGuard({
          model: "VirtualKey",
          action: "findMany",
          args: { where: { organizationId: "org_01", status: "ACTIVE" } },
        }),
      ).resolves.toBe("ok");
    });
  });
});

/**
 * Regression tests for SCOPED_MODELS — the stricter alternative to
 * EXEMPT_MODELS. These tables don't have a projectId column to
 * constrain on, but EVERY query must still carry a tenancy predicate
 * (row id, scope, or parent FK). A bare `findMany({})` must throw.
 *
 * Root cause: rchaves on 2026-05-18 dogfood pointed out that putting
 * ModelProvider + ModelDefaultConfig in EXEMPT_MODELS lets a
 * programmer accidentally write a cross-tenant query and have it
 * silently pass. The fix is per-model predicate enforcement, not a
 * full bypass.
 */
describe("guardProjectId — SCOPED_MODELS (ModelProvider family)", () => {
  describe("ModelProvider.findMany without any tenancy predicate", () => {
    /** @scenario A query without a tenancy predicate throws */
    it("THROWS — bare findMany must not walk every tenant", async () => {
      await expect(
        runGuard({
          model: "ModelProvider",
          action: "findMany",
          args: { where: {} },
        }),
      ).rejects.toThrow(/row id or scope predicate/);
    });
  });

  describe("ModelProvider.findMany with the cascade-walk OR predicate", () => {
    /** @scenario A query with scope predicate succeeds */
    it("does NOT throw — scope OR ladder is the canonical access pattern", async () => {
      await expect(
        runGuard({
          model: "ModelProvider",
          action: "findMany",
          args: {
            where: {
              scopes: {
                some: {
                  OR: [
                    { scopeType: "PROJECT", scopeId: "proj_01" },
                    { scopeType: "TEAM", scopeId: "team_01" },
                    { scopeType: "ORGANIZATION", scopeId: "org_01" },
                  ],
                },
              },
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelProvider.findFirst by id alone", () => {
    /** @scenario A single-row lookup by id passes */
    it("does NOT throw — id IS the tenancy proof for single-row lookup", async () => {
      await expect(
        runGuard({
          model: "ModelProvider",
          action: "findFirst",
          args: { where: { id: "mp_01" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelProvider.create without scopes", () => {
    /** @scenario A create without scopes throws */
    it("THROWS — every create needs a scopes relation in the payload", async () => {
      await expect(
        runGuard({
          model: "ModelProvider",
          action: "create",
          args: { data: { provider: "openai", enabled: true } },
        }),
      ).rejects.toThrow(/requires a 'scopes' relation/);
    });
  });

  describe("ModelProvider.create with scopes relation", () => {
    /** @scenario A nested-create through the scopes relation passes */
    it("does NOT throw — nested-create through the scopes relation carries tenancy", async () => {
      await expect(
        runGuard({
          model: "ModelProvider",
          action: "create",
          args: {
            data: {
              provider: "openai",
              enabled: true,
              scopes: {
                create: [{ scopeType: "ORGANIZATION", scopeId: "org_01" }],
              },
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelProviderScope.findMany without modelProviderId or scope", () => {
    /** @scenario Join-table bare findMany throws */
    it("THROWS — bare findMany on the join walks every tenant's bindings", async () => {
      await expect(
        runGuard({
          model: "ModelProviderScope",
          action: "findMany",
          args: { where: {} },
        }),
      ).rejects.toThrow(/row id.*modelProviderId.*scope predicate/);
    });
  });

  describe("ModelProviderScope.findMany with modelProviderId", () => {
    /** @scenario Join-table read with parent FK passes */
    it("does NOT throw — parent FK is the tenancy proof for joins", async () => {
      await expect(
        runGuard({
          model: "ModelProviderScope",
          action: "findMany",
          args: { where: { modelProviderId: "mp_01" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelProviderScope.deleteMany without parent FK or scope", () => {
    /** @scenario Join-table deleteMany requires a parent FK or scope predicate */
    it("THROWS — bare deleteMany would wipe every tenant's bindings", async () => {
      await expect(
        runGuard({
          model: "ModelProviderScope",
          action: "deleteMany",
          args: { where: {} },
        }),
      ).rejects.toThrow(/row id.*modelProviderId.*scope predicate/);
    });
  });
});

describe("guardProjectId — SCOPED_MODELS (ModelDefaultConfig family)", () => {
  describe("ModelDefaultConfig.findMany without any tenancy predicate", () => {
    it("THROWS — would walk every tenant's defaults", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "findMany",
          args: { where: {} },
        }),
      ).rejects.toThrow(/row id or scope predicate/);
    });
  });

  describe("ModelDefaultConfig.findMany with scopes.some.OR cascade", () => {
    it("does NOT throw — canonical resolver pattern", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "findMany",
          args: {
            where: {
              scopes: {
                some: {
                  OR: [
                    { scopeType: "PROJECT", scopeId: "proj_01" },
                    { scopeType: "TEAM", scopeId: "team_01" },
                    { scopeType: "ORGANIZATION", scopeId: "org_01" },
                  ],
                },
              },
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfig.findMany with scopeId: { in: [...] } list predicate", () => {
    /** @scenario List-shaped scopeId predicates pass the scope check */
    it("does NOT throw — org admins read across N teams + M projects via Prisma's { in: [...] } list", async () => {
      // getDefaultModelsForProject builds visibleScopeFilter with this
      // exact shape: one ORG branch with a string scopeId, plus TEAM
      // and PROJECT branches whose scopeId is { in: [...] } over every
      // team / project the caller can see. The list IS the tenancy
      // constraint.
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "findMany",
          args: {
            where: {
              scopes: {
                some: {
                  OR: [
                    { scopeType: "ORGANIZATION", scopeId: "org_01" },
                    { scopeType: "TEAM", scopeId: { in: ["t_a", "t_b"] } },
                    {
                      scopeType: "PROJECT",
                      scopeId: { in: ["p_a", "p_b", "p_c"] },
                    },
                  ],
                },
              },
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfig.findMany with scopeId: { in: [] } empty list", () => {
    /** @scenario Empty in-lists are not a valid tenancy constraint */
    it("THROWS — empty list constrains to zero scopes, so the branch is unsafe", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "findMany",
          args: {
            where: {
              scopes: {
                some: {
                  OR: [{ scopeType: "TEAM", scopeId: { in: [] } }],
                },
              },
            },
          },
        }),
      ).rejects.toThrow(/row id or scope predicate/);
    });
  });

  describe("ModelDefaultConfig.findMany with one OR branch missing scopeId", () => {
    /** @scenario A single bad OR branch invalidates the whole scope predicate */
    it("THROWS — every OR branch must constrain a tenancy boundary", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "findMany",
          args: {
            where: {
              scopes: {
                some: {
                  OR: [
                    { scopeType: "ORGANIZATION", scopeId: "org_01" },
                    { scopeType: "TEAM" } as any,
                  ],
                },
              },
            },
          },
        }),
      ).rejects.toThrow(/row id or scope predicate/);
    });
  });

  describe("ModelDefaultConfig.findMany with AND-wrapped scope predicate", () => {
    it("does NOT throw — exclude-id pattern wraps in AND but a child clause carries scope", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "findMany",
          args: {
            where: {
              AND: [
                { id: { not: "cfg_01" } },
                {
                  scopes: {
                    some: {
                      OR: [
                        { scopeType: "TEAM", scopeId: "team_01" },
                      ],
                    },
                  },
                },
              ],
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfig.update by id", () => {
    it("does NOT throw — id is the tenancy proof", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "update",
          args: {
            where: { id: "cfg_01" },
            data: { config: { DEFAULT: "openai/gpt-5.5" } },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfig.create without scopes", () => {
    it("THROWS — every config must attach to at least one scope at create time", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "create",
          args: { data: { config: { DEFAULT: "openai/gpt-5.5" } } },
        }),
      ).rejects.toThrow(/scopes/);
    });
  });

  describe("ModelDefaultConfig.create with nested scopes relation", () => {
    it("does NOT throw — nested create through the scopes relation", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfig",
          action: "create",
          args: {
            data: {
              config: { DEFAULT: "openai/gpt-5.5" },
              scopes: {
                create: [{ scopeType: "ORGANIZATION", scopeId: "org_01" }],
              },
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfigScope.findMany without configId or scope", () => {
    it("THROWS — bare findMany walks every tenant's attachments", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfigScope",
          action: "findMany",
          args: { where: {} },
        }),
      ).rejects.toThrow(/row id.*configId.*scope predicate/);
    });
  });

  describe("ModelDefaultConfigScope.findMany with configId", () => {
    it("does NOT throw — parent FK is the tenancy proof for joins", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfigScope",
          action: "findMany",
          args: { where: { configId: "cfg_01" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfigScope.createMany with configId+scope per record", () => {
    it("does NOT throw — every entry has the join-shape tenancy keys", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfigScope",
          action: "createMany",
          args: {
            data: [
              {
                configId: "cfg_01",
                scopeType: "ORGANIZATION",
                scopeId: "org_01",
              },
              { configId: "cfg_01", scopeType: "TEAM", scopeId: "team_01" },
            ],
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("ModelDefaultConfigScope.createMany missing scopeId on one entry", () => {
    it("THROWS — every entry must carry the full join shape", async () => {
      await expect(
        runGuard({
          model: "ModelDefaultConfigScope",
          action: "createMany",
          args: {
            data: [
              {
                configId: "cfg_01",
                scopeType: "ORGANIZATION",
                scopeId: "org_01",
              },
              { configId: "cfg_01", scopeType: "TEAM" } as any,
            ],
          },
        }),
      ).rejects.toThrow(/configId.*scopeType.*scopeId/);
    });
  });
});

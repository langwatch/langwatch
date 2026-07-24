import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  ORG_SCOPED_MODEL_NAMES,
  ORG_TENANCY_EXEMPT,
  guardOrganizationId,
} from "../dbOrganizationIdProtection";

/**
 * Tests for the organization-tenancy guard (ADR-021): the org-level mirror of
 * guardProjectId. Every org-scoped model must carry a single-organization
 * predicate on every query, no query may span two organizations, and a
 * partition test keeps the regime classification honest as the schema grows.
 */

async function runGuard(
  params: Partial<Prisma.MiddlewareParams> & {
    model: string;
    action: Prisma.MiddlewareParams["action"];
    args: Prisma.MiddlewareParams["args"];
  },
): Promise<unknown> {
  const next = vi.fn(async () => "ok");
  return guardOrganizationId(
    {
      dataPath: [],
      runInTransaction: false,
      ...params,
    } as Prisma.MiddlewareParams,
    next,
  );
}

describe("guardOrganizationId — original three models preserved", () => {
  describe("when querying OrganizationUser by the userId_organizationId composite", () => {
    it("does NOT throw — the composite key embeds organizationId", async () => {
      await expect(
        runGuard({
          model: "OrganizationUser",
          action: "findUnique",
          args: {
            where: { userId_organizationId: { userId: "u_1", organizationId: "org_1" } },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when querying OrganizationInvite by inviteCode", () => {
    it("does NOT throw — inviteCode resolves to one organization", async () => {
      await expect(
        runGuard({
          model: "OrganizationInvite",
          action: "findFirst",
          args: { where: { inviteCode: "inv_abc" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when querying Team by row id", () => {
    it("does NOT throw — id is the tenancy proof for a single-row lookup", async () => {
      await expect(
        runGuard({
          model: "Team",
          action: "findUnique",
          args: { where: { id: "team_1" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when creating an OrganizationUser without organizationId", () => {
    it("THROWS — every create must declare its owning organization", async () => {
      await expect(
        runGuard({
          model: "OrganizationUser",
          action: "create",
          args: { data: { userId: "u_1", role: "MEMBER" } },
        }),
      ).rejects.toThrow(/requires an 'organizationId'/);
    });
  });

  describe("when upserting a CustomRole whose create payload omits organizationId", () => {
    it("THROWS — upsert's create branch is held to the same anchor invariant", async () => {
      await expect(
        runGuard({
          model: "CustomRole",
          action: "upsert",
          args: {
            where: { organizationId_name: { organizationId: "org_1", name: "auditor" } },
            create: { name: "auditor", permissions: [] },
            update: {},
          },
        }),
      ).rejects.toThrow(/requires an 'organizationId' in the create payload/);
    });
  });

  describe("when upserting a CustomRole with organizationId in the create payload", () => {
    it("does NOT throw — both the where and the create payload are anchored", async () => {
      await expect(
        runGuard({
          model: "CustomRole",
          action: "upsert",
          args: {
            where: { organizationId_name: { organizationId: "org_1", name: "auditor" } },
            create: { organizationId: "org_1", name: "auditor", permissions: [] },
            update: {},
          },
        }),
      ).resolves.toBe("ok");
    });
  });
});

describe("guardOrganizationId — bare queries throw", () => {
  describe("when running findMany on CustomRole with no where", () => {
    it("THROWS — a bare findMany would walk every tenant's roles", async () => {
      await expect(
        runGuard({
          model: "CustomRole",
          action: "findMany",
          args: {},
        }),
      ).rejects.toThrow(/organizationId/);
    });
  });

  describe("when running findMany on Group with a non-tenancy filter only", () => {
    it("THROWS — a scimSource filter without organizationId is unbounded", async () => {
      await expect(
        runGuard({
          model: "Group",
          action: "findMany",
          args: { where: { scimSource: { not: null } } },
        }),
      ).rejects.toThrow(/organizationId/);
    });
  });
});

describe("guardOrganizationId — single-organization invariant", () => {
  describe("when an OR clause spans two organizations", () => {
    it("THROWS — no query may target two organizations at once", async () => {
      await expect(
        runGuard({
          model: "GatewayBudget",
          action: "findMany",
          args: {
            where: {
              OR: [
                { organizationId: "org_1" },
                { organizationId: "org_2" },
              ],
            },
          },
        }),
      ).rejects.toThrow(/must not span multiple organizations/);
    });
  });

  describe("when a forged organizationId is smuggled into an OR beside the real one", () => {
    it("THROWS — two distinct organizationId literals anywhere is rejected", async () => {
      await expect(
        runGuard({
          model: "RoleBinding",
          action: "findMany",
          args: {
            where: {
              organizationId: "org_1",
              OR: [
                { scopeType: "TEAM", scopeId: "team_1" },
                { organizationId: "other_org" },
              ],
            },
          },
        }),
      ).rejects.toThrow(/must not span multiple organizations/);
    });
  });

  describe("when organizationId sits beside an inner OR sub-filter", () => {
    it("does NOT throw — the query is already bounded to one org", async () => {
      await expect(
        runGuard({
          model: "ApiKey",
          action: "findFirst",
          args: {
            where: {
              organizationId: "org_1",
              OR: [{ userId: "u_1" }, { userId: null }],
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });
});

describe("guardOrganizationId — audited real query shapes pass", () => {
  describe("when querying RoleBinding by inline scope", () => {
    it("does NOT throw — (scopeType, scopeId) bounds to one org transitively", async () => {
      await expect(
        runGuard({
          model: "RoleBinding",
          action: "count",
          args: {
            where: {
              organizationId: "org_1",
              scopeType: "TEAM",
              scopeId: "team_1",
              role: "ADMIN",
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when deleting RoleBindings by parent apiKeyId", () => {
    it("does NOT throw — apiKeyId names a single org-owned key", async () => {
      await expect(
        runGuard({
          model: "RoleBinding",
          action: "deleteMany",
          args: { where: { apiKeyId: "ak_1" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when resolving an ApiKey by its globally-unique lookupId", () => {
    it("does NOT throw — lookupId is the auth-path single-org resolver", async () => {
      await expect(
        runGuard({
          model: "ApiKey",
          action: "findFirst",
          args: {
            where: {
              lookupId: "lk_1",
              OR: [{ revokedAt: null }, { expiresAt: null }],
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when looking up a CustomRole by row id", () => {
    it("does NOT throw — id is the tenancy proof for single-row lookup", async () => {
      await expect(
        runGuard({
          model: "CustomRole",
          action: "findUnique",
          args: { where: { id: "cr_1" } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when querying a Group by the organizationId_slug composite", () => {
    it("does NOT throw — the composite key embeds organizationId", async () => {
      await expect(
        runGuard({
          model: "Group",
          action: "findUnique",
          args: { where: { organizationId_slug: { organizationId: "org_1", slug: "eng" } } },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when listing org members with a userId in-list and organizationId", () => {
    it("does NOT throw — organizationId bounds the in-list to one org", async () => {
      await expect(
        runGuard({
          model: "OrganizationUser",
          action: "findMany",
          args: {
            where: { organizationId: "org_1", userId: { in: ["u_1", "u_2"] } },
          },
        }),
      ).resolves.toBe("ok");
    });
  });
});

describe("guardOrganizationId — unguarded models are ignored", () => {
  describe("when querying a model not in the org-scoped regime", () => {
    it("does NOT throw — Project is governed by guardProjectId, not here", async () => {
      await expect(
        runGuard({
          model: "Project",
          action: "findMany",
          args: { where: {} },
        }),
      ).resolves.toBe("ok");
    });
  });
});

/**
 * Regime partition test (ADR-021). Every Prisma model that carries an
 * organizationId column MUST be classified into exactly one regime: guarded by
 * ORG_SCOPED_MODELS or explicitly listed in ORG_TENANCY_EXEMPT. A new
 * org-bearing model that is neither fails this test, forcing a deliberate
 * tenancy decision instead of a silent leak.
 */
describe("organization-tenancy regime partition", () => {
  const orgBearingModels = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "organizationId"))
    .map((model) => model.name);

  it("covers every org-bearing model with exactly one regime", () => {
    const exemptSet = new Set(ORG_TENANCY_EXEMPT);
    const guardedSet = new Set(ORG_SCOPED_MODEL_NAMES);

    const unclassified = orgBearingModels.filter(
      (name) => !guardedSet.has(name) && !exemptSet.has(name),
    );
    expect(unclassified).toEqual([]);

    const doubleClassified = orgBearingModels.filter(
      (name) => guardedSet.has(name) && exemptSet.has(name),
    );
    expect(doubleClassified).toEqual([]);
  });

  it("never guards a model that lacks an organizationId column", () => {
    const orgBearing = new Set(orgBearingModels);
    const guardedWithoutColumn = ORG_SCOPED_MODEL_NAMES.filter(
      (name) => !orgBearing.has(name),
    );
    expect(guardedWithoutColumn).toEqual([]);
  });

  it("never exempts a model that lacks an organizationId column", () => {
    const orgBearing = new Set(orgBearingModels);
    const exemptWithoutColumn = ORG_TENANCY_EXEMPT.filter(
      (name) => !orgBearing.has(name),
    );
    expect(exemptWithoutColumn).toEqual([]);
  });
});

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { reapExpiredLangySessionApiKeys } from "~/server/app-layer/langy/langyApiKey";
import {
  guardOrganizationId,
  ORG_SCOPED_MODEL_NAMES,
  ORG_TENANCY_EXEMPT,
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
            where: {
              userId_organizationId: { userId: "u_1", organizationId: "org_1" },
            },
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
            where: {
              organizationId_name: { organizationId: "org_1", name: "auditor" },
            },
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
            where: {
              organizationId_name: { organizationId: "org_1", name: "auditor" },
            },
            create: {
              organizationId: "org_1",
              name: "auditor",
              permissions: [],
            },
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
              OR: [{ organizationId: "org_1" }, { organizationId: "org_2" }],
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
          args: {
            where: {
              organizationId_slug: { organizationId: "org_1", slug: "eng" },
            },
          },
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

describe("guardOrganizationId — the GitHub connection's tables", () => {
  describe("when looking a pull request up by repository alone", () => {
    it("THROWS — a repository name is not unique across organizations", async () => {
      await expect(
        runGuard({
          model: "GithubPullRequest",
          action: "findMany",
          args: {
            where: {
              repositoryHost: "github.com",
              repositoryFullName: "acme/service-x",
              headBranch: "feature/thing",
            },
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("when the same lookup names the organization", () => {
    it("does NOT throw — the query is bounded to one tenant", async () => {
      await expect(
        runGuard({
          model: "GithubPullRequest",
          action: "findMany",
          args: {
            where: {
              organizationId: "org-1",
              repositoryHost: "github.com",
              repositoryFullName: "acme/service-x",
              headBranch: "feature/thing",
            },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when sweeping branch checks due for a recheck", () => {
    it("THROWS without an organization, resolves with one", async () => {
      await expect(
        runGuard({
          model: "GithubBranchPullRequestCheck",
          action: "findMany",
          args: { where: { notFoundAt: { not: null } } },
        }),
      ).rejects.toThrow();

      await expect(
        runGuard({
          model: "GithubBranchPullRequestCheck",
          action: "findMany",
          args: {
            where: { organizationId: "org-1", notFoundAt: { not: null } },
          },
        }),
      ).resolves.toBe("ok");
    });
  });

  describe("when reading the connection by its GitHub installation id", () => {
    it("does NOT throw — an installation id names exactly one organization", async () => {
      await expect(
        runGuard({
          model: "GithubInstallation",
          action: "findUnique",
          args: { where: { installationId: "555" } },
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
    .filter((model) =>
      model.fields.some((field) => field.name === "organizationId"),
    )
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

/**
 * The expired-Langy-session sweep is deliberately cross-tenant: it revokes every
 * elapsed platform-minted session key, whoever owns it. It carries no
 * organizationId, no row id and no lookupId, so the guard rejected it on every
 * run — the reaper its own docstring calls "THE GUARANTEE" had never revoked a
 * single key, and the metric that was meant to warn when revoke-on-death slipped
 * was pinned at zero.
 */
describe("guardOrganizationId — platform-owned API-key sweeps", () => {
  /**
   * A Prisma stand-in that installs the SAME middleware the real client does
   * (`db.ts` → `prisma.$use(guardOrganizationId)`), so a call through it is
   * subject to the guard exactly as it is in production. No database: the guard
   * is a pure function of the query arguments.
   */
  function guardedPrisma(rowsAffected: number) {
    const calls: unknown[] = [];
    const client = {
      apiKey: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return guardOrganizationId(
            {
              model: "ApiKey",
              action: "updateMany",
              args,
              dataPath: [],
              runInTransaction: false,
            } as Prisma.MiddlewareParams,
            async () => ({ count: rowsAffected }),
          );
        },
      },
    };
    return { client, calls };
  }

  /**
   * The where clause the REAL reaper writes, captured by running it through the
   * guarded stand-in above.
   *
   * Every denied case below starts from THIS object rather than a re-typed copy
   * of it. Re-typed literals are how the escape hatch drifted wider than the
   * sweep it claimed to match: the guard's predicate was written to describe the
   * reaper's and then only ever compared to it by eye, so it went on admitting
   * shapes — un-expired keys, on any action — the reaper never writes. Deriving
   * the attack shapes from the reaper keeps them tracking it: change the sweep
   * and these cases change with it, or fail.
   */
  async function captureSweepWhere(): Promise<Record<string, unknown>> {
    const { client, calls } = guardedPrisma(0);
    await reapExpiredLangySessionApiKeys({
      prisma: client as unknown as PrismaClient,
      now: new Date("2026-07-28T12:00:00Z"),
    });
    return (calls[0] as { where: Record<string, unknown> }).where;
  }

  describe("when the expired-Langy-session reaper runs its real hourly sweep", () => {
    /**
     * The REAL reaper, not a re-typed copy of its where clause.
     *
     * What this pins is an INTERACTION — the reaper writes a predicate, the
     * guard decides whether to admit it — and an interaction cannot be pinned
     * by asserting a hand-copied literal on each side: generalise the reaper's
     * predicate (say, to `name: { in: HIDDEN_SYSTEM_KEY_NAMES }`, or drop its
     * un-revoked clause) and each literal still matches its own copy while
     * every hourly tick throws in production. Driving the actual function
     * through the actual middleware means drift on EITHER side fails here.
     */
    it("passes the guard and revokes the rows", async () => {
      const { client, calls } = guardedPrisma(2);

      await expect(
        reapExpiredLangySessionApiKeys({
          prisma: client as unknown as PrismaClient,
          now: new Date("2026-07-28T12:00:00Z"),
        }),
      ).resolves.toBe(2);

      expect(calls).toHaveLength(1);
    });
  });

  describe("when the sweep's own shape is replayed as a cross-tenant read", () => {
    it("THROWS — the hatch is granted to the sweep's updateMany, never to findMany", async () => {
      // Exactly the predicate the guard admits for the reaper. Run as a read it
      // hands back every organization's platform-minted keys, which is not a
      // sweep — so the action, not just the shape, has to match.
      const where = await captureSweepWhere();

      await expect(
        runGuard({ model: "ApiKey", action: "findMany", args: { where } }),
      ).rejects.toThrow(/tenancy key/);
    });
  });

  describe("when the sweep's own shape is replayed as a cross-tenant delete", () => {
    it("THROWS — the reaper revokes rows, so nothing here authorises removing them", async () => {
      const where = await captureSweepWhere();

      await expect(
        runGuard({ model: "ApiKey", action: "deleteMany", args: { where } }),
      ).rejects.toThrow(/tenancy key/);
    });
  });

  describe("when an updateMany carries the sweep's name and un-revoked clause but no expiry bound", () => {
    it("THROWS — that predicate is every LIVE session key, in every organization", async () => {
      const { expiresAt: _elapsed, ...withoutExpiryBound } =
        await captureSweepWhere();

      await expect(
        runGuard({
          model: "ApiKey",
          action: "updateMany",
          args: {
            where: withoutExpiryBound,
            data: { revokedAt: new Date() },
          },
        }),
      ).rejects.toThrow(/tenancy key/);
    });
  });

  describe("when an updateMany keeps an expiresAt clause but drops its elapsed bound", () => {
    it("THROWS — 'has an expiry' still names live keys; only 'already passed' does not", async () => {
      const where = {
        ...(await captureSweepWhere()),
        expiresAt: { not: null },
      };

      await expect(
        runGuard({
          model: "ApiKey",
          action: "updateMany",
          args: { where, data: { revokedAt: new Date() } },
        }),
      ).rejects.toThrow(/tenancy key/);
    });
  });

  describe("when a reserved-name query omits the sweep's un-revoked clause", () => {
    it("THROWS — the name escape admits the sweep's shape, not any named read", async () => {
      // The reserved name alone is sound for tenancy but far wider than the
      // sweep needs: it would also admit a read of every session key that ever
      // existed. `revokedAt: null` is what the reaper carries and an
      // exfiltrating query would not.
      await expect(
        runGuard({
          model: "ApiKey",
          action: "findMany",
          args: { where: { name: "Langy session" } },
        }),
      ).rejects.toThrow();
    });
  });

  describe("when a query names a key a customer could own", () => {
    it("THROWS — only RESERVED names are platform-owned by construction", async () => {
      await expect(
        runGuard({
          model: "ApiKey",
          action: "updateMany",
          args: {
            where: { name: "My production key", revokedAt: null },
            data: { revokedAt: new Date() },
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("when a query tries to widen a reserved name with a matcher", () => {
    it("THROWS — the name must match exactly, not by contains/startsWith", async () => {
      await expect(
        runGuard({
          model: "ApiKey",
          action: "updateMany",
          args: {
            where: { name: { contains: "Langy session" } },
            data: { revokedAt: new Date() },
          },
        }),
      ).rejects.toThrow();
    });
  });
});

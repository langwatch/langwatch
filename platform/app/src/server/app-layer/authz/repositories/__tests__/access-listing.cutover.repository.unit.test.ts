import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import {
  ENGINE_GATE_CACHE_TTL_MS,
  resetAuthzEngineGateForTesting,
} from "../../engine-gate";
import { CutoverAwareAccessListingRepository } from "../access-listing.cutover.repository";
import type { AccessListingRepository } from "../access-listing.repository";

/**
 * The decorator answers one question per call - is THIS organization served
 * by the engine - and delegates. What the tests pin is which head each
 * listing reaches, because a listing that forked the wrong way would render
 * an Access page from rows the organization is not being served from: access
 * that does not exist shown, access that does hidden.
 */
const spyRepository = (name: string): AccessListingRepository =>
  ({
    findUserBindings: vi.fn().mockResolvedValue([]),
    // A row only this head could have produced, so the ROWS a listing returns
    // name the head that served it - the proof style the spec section states.
    // Spying on the call alone would not catch a delegator that asked the
    // right head and then returned something else.
    findOrganizationBindings: vi
      .fn()
      .mockResolvedValue([{ id: `row-from-${name}` }]),
    findUserAndGroupBindings: vi.fn().mockResolvedValue([]),
    findScopeBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findTeamMemberBindings: vi.fn().mockResolvedValue(new Map()),
    findBindingsForSynthesis: vi
      .fn()
      .mockImplementation(async ({ orgIds }: { orgIds: readonly string[] }) =>
        orgIds.map((organizationId) => ({
          organizationId,
          scopeType: "TEAM",
          scopeId: `team-of-${organizationId}`,
          role: "MEMBER",
          customRoleId: null,
          customRole: null,
          head: name,
        })),
      ),
    findUserCreatedRoles: vi.fn().mockResolvedValue([]),
  }) as unknown as AccessListingRepository;

const repositoryFor = (onEngineByOrg: Record<string, boolean>) => {
  const legacy = spyRepository("legacy");
  const grants = spyRepository("grants");
  const findUnique = vi.fn(
    async ({ where }: { where: { organizationId: string } }) => ({
      onEngine: onEngineByOrg[where.organizationId] === true,
    }),
  );
  const prisma = {
  } as unknown as Prisma.TransactionClient;
  return {
    legacy,
    grants,
    repository: new CutoverAwareAccessListingRepository(prisma, {
      legacy,
      grants,
    }),
  };
};

describe("CutoverAwareAccessListingRepository", () => {
  beforeEach(() => {
    resetAuthzEngineGateForTesting();
  });
  afterEach(() => {
    resetAuthzEngineGateForTesting();
    vi.useRealTimers();
  });

  describe("given the organization is cut over", () => {
    /** @scenario "A cut-over organization's access listings are served from the ledger's head" */
    it("lists every binding surface from the grants head, leaving the legacy head untouched", async () => {
      const { legacy, grants, repository } = repositoryFor({ "org-1": true });

      await repository.findUserBindings({
        organizationId: "org-1",
        userId: "alice",
      });
      const organizationRows = await repository.findOrganizationBindings({
        organizationId: "org-1",
      });
      await repository.findUserAndGroupBindings({
        organizationId: "org-1",
        userId: "alice",
        groupIds: ["group-1"],
      });
      await repository.findScopeBindings({
        organizationId: "org-1",
        scopeType: "TEAM",
        scopeIds: ["team-1"],
      });
      await repository.findGroupBindings({
        organizationId: "org-1",
        groupId: "group-1",
      });
      await repository.findTeamMemberBindings({
        organizationId: "org-1",
        teamIds: ["team-1"],
      });

      expect(organizationRows).toEqual([{ id: "row-from-grants" }]);
      expect(grants.findUserBindings).toHaveBeenCalledTimes(1);
      expect(grants.findOrganizationBindings).toHaveBeenCalledTimes(1);
      expect(grants.findUserAndGroupBindings).toHaveBeenCalledTimes(1);
      expect(grants.findScopeBindings).toHaveBeenCalledTimes(1);
      expect(grants.findGroupBindings).toHaveBeenCalledTimes(1);
      expect(grants.findTeamMemberBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findUserBindings).not.toHaveBeenCalled();
      expect(legacy.findOrganizationBindings).not.toHaveBeenCalled();
      expect(legacy.findUserAndGroupBindings).not.toHaveBeenCalled();
      expect(legacy.findScopeBindings).not.toHaveBeenCalled();
      expect(legacy.findGroupBindings).not.toHaveBeenCalled();
      expect(legacy.findTeamMemberBindings).not.toHaveBeenCalled();
    });

    /** @scenario "A cut-over organization's role editor lists roles from the ledger's head" */
    it("lists the role editor's roles from the grants head", async () => {
      const { legacy, grants, repository } = repositoryFor({ "org-1": true });

      await repository.findUserCreatedRoles({ organizationId: "org-1" });

      expect(grants.findUserCreatedRoles).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(legacy.findUserCreatedRoles).not.toHaveBeenCalled();
    });
  });

  describe("given the organization has not cut over", () => {
    /** @scenario "An organization that has not cut over keeps listing from the legacy tables" */
    it("lists from the legacy head, leaving the grants head untouched", async () => {
      const { legacy, grants, repository } = repositoryFor({ "org-1": false });

      const organizationRows = await repository.findOrganizationBindings({
        organizationId: "org-1",
      });
      await repository.findUserCreatedRoles({ organizationId: "org-1" });

      expect(organizationRows).toEqual([{ id: "row-from-legacy" }]);
      expect(legacy.findOrganizationBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findUserCreatedRoles).toHaveBeenCalledTimes(1);
      expect(grants.findOrganizationBindings).not.toHaveBeenCalled();
      expect(grants.findUserCreatedRoles).not.toHaveBeenCalled();
    });

    // The mirror of the cut-over case above. The delegator is eight near
    // identical one-liners, so the defect to catch is one of them naming a
    // head instead of asking: such a method passes the cut-over test and is
    // never called again. A not-cut-over organization reaching the grant
    // head would render an empty Access page - everyone's access hidden.
    it("lists every binding surface from the legacy head, leaving the grants head untouched", async () => {
      const { legacy, grants, repository } = repositoryFor({ "org-1": false });

      await repository.findUserBindings({
        organizationId: "org-1",
        userId: "alice",
      });
      await repository.findOrganizationBindings({ organizationId: "org-1" });
      await repository.findUserAndGroupBindings({
        organizationId: "org-1",
        userId: "alice",
        groupIds: ["group-1"],
      });
      await repository.findScopeBindings({
        organizationId: "org-1",
        scopeType: "TEAM",
        scopeIds: ["team-1"],
      });
      await repository.findGroupBindings({
        organizationId: "org-1",
        groupId: "group-1",
      });
      await repository.findTeamMemberBindings({
        organizationId: "org-1",
        teamIds: ["team-1"],
      });

      expect(legacy.findUserBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findOrganizationBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findUserAndGroupBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findScopeBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findGroupBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findTeamMemberBindings).toHaveBeenCalledTimes(1);
      expect(grants.findUserBindings).not.toHaveBeenCalled();
      expect(grants.findOrganizationBindings).not.toHaveBeenCalled();
      expect(grants.findUserAndGroupBindings).not.toHaveBeenCalled();
      expect(grants.findScopeBindings).not.toHaveBeenCalled();
      expect(grants.findGroupBindings).not.toHaveBeenCalled();
      expect(grants.findTeamMemberBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the synthesis read spans cut-over and legacy organizations", () => {
    it("partitions the organizations across the heads and concatenates the rows", async () => {
      const { legacy, grants, repository } = repositoryFor({
        "org-engine": true,
        "org-legacy": false,
      });

      const rows = await repository.findBindingsForSynthesis({
        orgIds: ["org-engine", "org-legacy"],
        userId: "alice",
      });

      expect(legacy.findBindingsForSynthesis).toHaveBeenCalledWith({
        orgIds: ["org-legacy"],
        userId: "alice",
      });
      expect(grants.findBindingsForSynthesis).toHaveBeenCalledWith({
        orgIds: ["org-engine"],
        userId: "alice",
      });
      const tagged = rows as unknown as Array<{
        organizationId: string;
        head: string;
      }>;
      expect(
        tagged.map(({ organizationId, head }) => ({ organizationId, head })),
      ).toEqual([
        { organizationId: "org-legacy", head: "legacy" },
        { organizationId: "org-engine", head: "grants" },
      ]);
    });

    it("asks only the head that has organizations to answer for", async () => {
      const { legacy, grants, repository } = repositoryFor({
        "org-legacy": false,
      });

      await repository.findBindingsForSynthesis({
        orgIds: ["org-legacy"],
        userId: "alice",
      });

      expect(grants.findBindingsForSynthesis).not.toHaveBeenCalled();
      expect(legacy.findBindingsForSynthesis).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the organization is rolled back after the gate cached a positive answer", () => {
    /** @scenario "A rolled-back organization's listings return to the legacy head within the gate's cache window" */
    it("stops reading the grant head once the cache window elapses, with no deploy", async () => {
      vi.useFakeTimers();
      const legacy = spyRepository("legacy");
      const grants = spyRepository("grants");
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ onEngine: true })
        .mockResolvedValueOnce({ onEngine: false })
        .mockResolvedValue({ onEngine: false });
      const prisma = {
      } as unknown as Prisma.TransactionClient;
      const repository = new CutoverAwareAccessListingRepository(prisma, {
        legacy,
        grants,
      });

      await repository.findOrganizationBindings({ organizationId: "org-1" });
      expect(grants.findOrganizationBindings).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledTimes(1);

      // Still inside the window: the rollback has happened in the projection
      // but this pod is entitled to its cached answer, and must not have gone
      // back to the projection to get it. Without this half, the assertion
      // below would hold with no cache at all, or with the TTL widened to a
      // day - it would prove "eventually", not "within one window".
      vi.advanceTimersByTime(ENGINE_GATE_CACHE_TTL_MS - 1);
      await repository.findOrganizationBindings({ organizationId: "org-1" });
      expect(grants.findOrganizationBindings).toHaveBeenCalledTimes(2);
      expect(legacy.findOrganizationBindings).not.toHaveBeenCalled();
      expect(findUnique).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2_000);

      await repository.findOrganizationBindings({ organizationId: "org-1" });
      expect(legacy.findOrganizationBindings).toHaveBeenCalledTimes(1);
      expect(grants.findOrganizationBindings).toHaveBeenCalledTimes(2);
      expect(findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // Every test above hands in its own pair of heads. No production call site
  // does: they all construct the one-argument form and take the constructor's
  // defaults. Those defaults are the only thing deciding which table a real
  // Access page reads, and swapping them typechecks - same interface - and
  // leaves every other test in this file green while the feature is inert.
  describe("when the fork is composed the way every call site composes it", () => {
    const prismaDouble = (onEngine: boolean) => {
      const grantFindMany = vi.fn().mockResolvedValue([]);
      const roleBindingFindMany = vi.fn().mockResolvedValue([]);
      const prisma = {
        systemMigrationTenantState: {
      findUnique: vi
        .fn()
        .mockResolvedValue(onEngine ? { status: "migrated" } : null),
    },
        grant: { findMany: grantFindMany },
        roleBinding: { findMany: roleBindingFindMany },
        user: { findMany: vi.fn().mockResolvedValue([]) },
        group: { findMany: vi.fn().mockResolvedValue([]) },
        apiKey: { findMany: vi.fn().mockResolvedValue([]) },
        role: { findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as Prisma.TransactionClient;
      return { prisma, grantFindMany, roleBindingFindMany };
    };

    it("reads the grant table for a cut-over organization", async () => {
      const { prisma, grantFindMany, roleBindingFindMany } = prismaDouble(true);

      await new CutoverAwareAccessListingRepository(
        prisma,
      ).findOrganizationBindings({ organizationId: "org-1" });

      expect(grantFindMany).toHaveBeenCalledTimes(1);
      expect(roleBindingFindMany).not.toHaveBeenCalled();
    });

    it("reads the binding table for an organization that has not cut over", async () => {
      const { prisma, grantFindMany, roleBindingFindMany } =
        prismaDouble(false);

      await new CutoverAwareAccessListingRepository(
        prisma,
      ).findOrganizationBindings({ organizationId: "org-1" });

      expect(roleBindingFindMany).toHaveBeenCalledTimes(1);
      expect(grantFindMany).not.toHaveBeenCalled();
    });
  });
});

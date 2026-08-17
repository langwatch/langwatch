import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthzReadRepository } from "@langwatch/authz-server";
import type { Prisma } from "~/generated/prisma/client";
import { resetCutoverGateForTesting } from "../../cutover-gate";
import { CutoverAwareAuthzReadRepository } from "../authz-read.cutover.repository";

/**
 * The decorator answers one question per call - is THIS organization served by
 * the engine - and then gets out of the way. What the tests below pin is which
 * head each method reaches, because a method that forked the wrong way would
 * answer a permission check from rows the organization is not being served
 * from, and nothing downstream would notice.
 */
const spyRepository = (name: string): AuthzReadRepository =>
  ({
    findOrganizationRole: vi.fn().mockResolvedValue(name),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findApiKeyOwner: vi.fn().mockResolvedValue({ userId: name }),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi
      .fn()
      .mockResolvedValue({ teamId: "team-1", organizationId: "org-1" }),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
  }) as unknown as AuthzReadRepository;

const repositoryFor = (onEngine: boolean) => {
  const legacy = spyRepository("legacy");
  const grants = spyRepository("grants");
  const prisma = {
    authzCutoverProjection: {
      findUnique: vi.fn().mockResolvedValue({ onEngine }),
    },
  } as unknown as Prisma.TransactionClient;
  return {
    legacy,
    grants,
    repository: new CutoverAwareAuthzReadRepository(prisma, {
      legacy,
      grants,
    }),
  };
};

describe("CutoverAwareAuthzReadRepository", () => {
  beforeEach(() => {
    resetCutoverGateForTesting();
  });
  afterEach(() => {
    resetCutoverGateForTesting();
  });

  describe("given the organization is cut over", () => {
    it("collects bindings from the grants head, leaving the legacy head untouched", async () => {
      const { legacy, grants, repository } = repositoryFor(true);
      const args = { userId: "alice", organizationId: "org-1" };

      await repository.findUserBindings(args);
      await repository.findGroupBindings(args);
      await repository.findLegacyTeamMemberships(args);

      expect(grants.findUserBindings).toHaveBeenCalledWith(args);
      expect(grants.findGroupBindings).toHaveBeenCalledWith(args);
      expect(grants.findLegacyTeamMemberships).toHaveBeenCalledWith(args);
      expect(legacy.findUserBindings).not.toHaveBeenCalled();
      expect(legacy.findGroupBindings).not.toHaveBeenCalled();
      expect(legacy.findLegacyTeamMemberships).not.toHaveBeenCalled();
    });

    it("reads an API key's grants and custom roles from the grants head", async () => {
      const { legacy, grants, repository } = repositoryFor(true);

      await repository.findApiKeyBindings({
        apiKeyId: "key-1",
        organizationId: "org-1",
      });
      await repository.findCustomRolePermissions({
        organizationId: "org-1",
        principal: { type: "apiKey", id: "key-1" },
        customRoleIds: ["role-1"],
      });

      expect(grants.findApiKeyBindings).toHaveBeenCalledTimes(1);
      expect(grants.findCustomRolePermissions).toHaveBeenCalledTimes(1);
      expect(legacy.findApiKeyBindings).not.toHaveBeenCalled();
      expect(legacy.findCustomRolePermissions).not.toHaveBeenCalled();
    });

    it("resolves the share link's organization through the project's lineage first", async () => {
      const { legacy, grants, repository } = repositoryFor(true);
      const args = {
        projectId: "proj-1",
        tokens: ["tok-1"],
        links: [{ kind: "trace" as const, id: "trace-1" }],
      };

      await repository.findShareLinks(args);

      // The port hands this method a project, not an organization - ShareLink's
      // tenancy is its project - so the fork needs the lineage to know which
      // head to ask.
      expect(legacy.findProjectLineage).toHaveBeenCalledWith({
        projectId: "proj-1",
      });
      expect(grants.findShareLinks).toHaveBeenCalledWith(args);
      expect(legacy.findShareLinks).not.toHaveBeenCalled();
    });
  });

  describe("given the organization is not cut over", () => {
    it("collects everything from the legacy head, leaving the grants head untouched", async () => {
      const { legacy, grants, repository } = repositoryFor(false);
      const args = { userId: "alice", organizationId: "org-1" };

      await repository.findUserBindings(args);
      await repository.findGroupBindings(args);
      await repository.findLegacyTeamMemberships(args);
      await repository.findApiKeyBindings({
        apiKeyId: "key-1",
        organizationId: "org-1",
      });
      await repository.findCustomRolePermissions({
        organizationId: "org-1",
        principal: { type: "user", id: "alice" },
        customRoleIds: ["role-1"],
      });
      await repository.findShareLinks({
        projectId: "proj-1",
        tokens: ["tok-1"],
        links: [{ kind: "trace", id: "trace-1" }],
      });

      expect(legacy.findUserBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findGroupBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findLegacyTeamMemberships).toHaveBeenCalledTimes(1);
      expect(legacy.findApiKeyBindings).toHaveBeenCalledTimes(1);
      expect(legacy.findCustomRolePermissions).toHaveBeenCalledTimes(1);
      expect(legacy.findShareLinks).toHaveBeenCalledTimes(1);
      expect(grants.findUserBindings).not.toHaveBeenCalled();
      expect(grants.findGroupBindings).not.toHaveBeenCalled();
      expect(grants.findLegacyTeamMemberships).not.toHaveBeenCalled();
      expect(grants.findApiKeyBindings).not.toHaveBeenCalled();
      expect(grants.findCustomRolePermissions).not.toHaveBeenCalled();
      expect(grants.findShareLinks).not.toHaveBeenCalled();
    });
  });

  describe("when the query is the same against either head", () => {
    it("serves membership, key ownership and lineage from the legacy repository", async () => {
      const { legacy, grants, repository } = repositoryFor(true);

      // Membership and lineage were never projected onto the ledger's head:
      // both implementations run the same query against the same table, so
      // forking them would cost a gate read and change nothing.
      expect(
        await repository.findOrganizationRole({
          userId: "alice",
          organizationId: "org-1",
        }),
      ).toBe("legacy");
      expect(await repository.findApiKeyOwner("key-1")).toEqual({
        userId: "legacy",
      });
      await repository.findProjectLineage({ projectId: "proj-1" });
      await repository.findTeamOrganization({ teamId: "team-1" });

      expect(grants.findOrganizationRole).not.toHaveBeenCalled();
      expect(grants.findApiKeyOwner).not.toHaveBeenCalled();
      expect(grants.findProjectLineage).not.toHaveBeenCalled();
      expect(grants.findTeamOrganization).not.toHaveBeenCalled();
      expect(legacy.findTeamOrganization).toHaveBeenCalledWith({
        teamId: "team-1",
      });
    });
  });

  describe("when the project a share link names is unknown", () => {
    it("stays on the legacy head rather than swapping heads silently", async () => {
      const { legacy, grants, repository } = repositoryFor(true);
      (legacy.findProjectLineage as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );

      await repository.findShareLinks({
        projectId: "proj-ghost",
        tokens: ["tok-1"],
        links: [{ kind: "trace", id: "trace-1" }],
      });

      expect(legacy.findShareLinks).toHaveBeenCalledTimes(1);
      expect(grants.findShareLinks).not.toHaveBeenCalled();
    });
  });

  describe("when several calls ask about the same organization", () => {
    it("reads the projection once, because the gate caches the answer", async () => {
      const findUnique = vi.fn().mockResolvedValue({ onEngine: true });
      const prisma = {
        authzCutoverProjection: { findUnique },
      } as unknown as Prisma.TransactionClient;
      const repository = new CutoverAwareAuthzReadRepository(prisma, {
        legacy: spyRepository("legacy"),
        grants: spyRepository("grants"),
      });
      const args = { userId: "alice", organizationId: "org-1" };

      await repository.findUserBindings(args);
      await repository.findGroupBindings(args);

      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });
});

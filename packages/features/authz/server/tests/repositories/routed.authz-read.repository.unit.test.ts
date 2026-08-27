import { describe, expect, it, vi } from "vitest";
import type {
  AuthzDatabase,
  AuthzReadRepository,
} from "../../src/repositories/authz-read.repository";
import { RoutedAuthzReadRepository } from "../../src/repositories/routed/routed.authz-read.repository";

const spyRepository = (name: string): AuthzReadRepository =>
  ({
    beginPass: vi.fn(),
    tryFindOrganizationMembership: vi.fn().mockResolvedValue({ role: "MEMBER", disabled: false }),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    tryFindApiKeyOwner: vi.fn().mockResolvedValue({ userId: name }),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    tryFindProjectLineage: vi.fn().mockResolvedValue({ teamId: "team-1", organizationId: "org-1" }),
    tryFindTeamOrganization: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
  }) as unknown as AuthzReadRepository;

const repositoryFor = (selectHead: (organizationId: string) => Promise<boolean>) => {
  const legacy = spyRepository("legacy");
  const eventing = spyRepository("eventing");
  return {
    legacy,
    eventing,
    repository: RoutedAuthzReadRepository.create({
      database: {} as AuthzDatabase,
      selectHead,
      repositories: { legacy, eventing },
    }),
  };
};

describe("RoutedAuthzReadRepository", () => {
  it("routes access-bearing reads to the projected head after cutover", async () => {
    const { legacy, eventing, repository } = repositoryFor(async () => true);
    const userArgs = { userId: "alice", organizationId: "org-1" };

    await repository.findUserBindings(userArgs);
    await repository.findGroupBindings(userArgs);
    await repository.findLegacyTeamMemberships(userArgs);
    await repository.findApiKeyBindings({
      apiKeyId: "key-1",
      organizationId: "org-1",
    });
    await repository.findCustomRolePermissions({
      organizationId: "org-1",
      principal: { type: "apiKey", id: "key-1" },
      customRoleIds: ["role-1"],
    });

    expect(eventing.findUserBindings).toHaveBeenCalledWith(userArgs);
    expect(eventing.findGroupBindings).toHaveBeenCalledWith(userArgs);
    expect(eventing.findLegacyTeamMemberships).toHaveBeenCalledWith(userArgs);
    expect(eventing.findApiKeyBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findCustomRolePermissions).toHaveBeenCalledTimes(1);
    expect(legacy.findUserBindings).not.toHaveBeenCalled();
  });

  it("routes access-bearing reads to the legacy head before cutover", async () => {
    const { legacy, eventing, repository } = repositoryFor(async () => false);
    const args = { userId: "alice", organizationId: "org-1" };

    await repository.findUserBindings(args);
    await repository.findGroupBindings(args);

    expect(legacy.findUserBindings).toHaveBeenCalledWith(args);
    expect(legacy.findGroupBindings).toHaveBeenCalledWith(args);
    expect(eventing.findUserBindings).not.toHaveBeenCalled();
  });

  it("keeps membership, API-key ownership, and lineage on their canonical tables", async () => {
    const selectHead = vi.fn().mockResolvedValue(true);
    const { legacy, eventing, repository } = repositoryFor(selectHead);

    expect(
      await repository.tryFindOrganizationMembership({
        userId: "alice",
        organizationId: "org-1",
      }),
    ).toEqual({ role: "MEMBER", disabled: false });
    expect(await repository.tryFindApiKeyOwner("key-1")).toEqual({
      userId: "legacy",
    });
    await repository.tryFindProjectLineage({ projectId: "project-1" });
    await repository.tryFindTeamOrganization({ teamId: "team-1" });

    expect(selectHead).not.toHaveBeenCalled();
    expect(eventing.tryFindOrganizationMembership).not.toHaveBeenCalled();
    expect(legacy.tryFindTeamOrganization).toHaveBeenCalledWith({
      teamId: "team-1",
    });
  });

  it("resolves a share link's organization before selecting a head", async () => {
    const selectHead = vi.fn().mockResolvedValue(true);
    const { legacy, eventing, repository } = repositoryFor(selectHead);
    const args = {
      projectId: "project-1",
      tokens: ["token-1"],
      links: [{ kind: "trace" as const, id: "trace-1" }],
    };

    await repository.findShareLinks(args);

    expect(selectHead).toHaveBeenCalledWith("org-1");
    expect(eventing.findShareLinks).toHaveBeenCalledWith({
      ...args,
      organizationId: "org-1",
    });
    expect(legacy.findShareLinks).not.toHaveBeenCalled();
  });

  it("uses the legacy share-link reader when project lineage is unknown", async () => {
    const { legacy, eventing, repository } = repositoryFor(async () => true);
    vi.mocked(legacy.tryFindProjectLineage).mockResolvedValue(null);

    await repository.findShareLinks({
      projectId: "missing",
      tokens: ["token-1"],
      links: [{ kind: "trace", id: "trace-1" }],
    });

    expect(legacy.findShareLinks).toHaveBeenCalledTimes(1);
    expect(eventing.findShareLinks).not.toHaveBeenCalled();
  });

  it("pins one head per organization for the lifetime of a read pass", async () => {
    const selectHead = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const { legacy, eventing, repository } = repositoryFor(selectHead);
    const args = { userId: "alice", organizationId: "org-1" };

    await repository.findUserBindings(args);
    await repository.findGroupBindings(args);

    expect(selectHead).toHaveBeenCalledTimes(1);
    expect(eventing.findUserBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findGroupBindings).toHaveBeenCalledTimes(1);
    expect(legacy.findGroupBindings).not.toHaveBeenCalled();
  });

  it("lets a new pass observe a rollback", async () => {
    const selectHead = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const { legacy, eventing, repository } = repositoryFor(selectHead);
    const args = { userId: "alice", organizationId: "org-1" };

    await repository.findUserBindings(args);
    await repository.beginPass().findUserBindings(args);

    expect(eventing.findUserBindings).toHaveBeenCalledTimes(1);
    expect(legacy.findUserBindings).toHaveBeenCalledTimes(1);
  });
});

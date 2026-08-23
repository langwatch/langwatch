import { describe, expect, it, vi } from "vitest";
import type { AuthzListingRepository } from "../../src/repositories/authz-listing.repository";
import type { AuthzDatabase } from "../../src/repositories/authz-read.repository";
import { RoutedAuthzListingRepository } from "../../src/repositories/routed/routed.authz-listing.repository";

const spyRepository = (name: string): AuthzListingRepository =>
  ({
    findUserBindings: vi.fn().mockResolvedValue([]),
    findOrganizationBindings: vi
      .fn()
      .mockResolvedValue([{ id: "row-from-" + name }]),
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
          scopeId: "team-of-" + organizationId,
          role: "MEMBER",
          customRoleId: null,
          customRole: null,
          head: name,
        })),
      ),
    findUserCreatedRoles: vi.fn().mockResolvedValue([]),
  }) as unknown as AuthzListingRepository;

const repositoryFor = (onEventingByOrg: Record<string, boolean>) => {
  const legacy = spyRepository("legacy");
  const eventing = spyRepository("eventing");
  const selectHead = vi.fn(
    async (organizationId: string) => onEventingByOrg[organizationId] === true,
  );
  return {
    legacy,
    eventing,
    selectHead,
    repository: RoutedAuthzListingRepository.create({
      database: {} as AuthzDatabase,
      selectHead,
      repositories: { legacy, eventing },
    }),
  };
};

describe("RoutedAuthzListingRepository", () => {
  it("routes every single-organization listing to the projected head after cutover", async () => {
    const { legacy, eventing, repository } = repositoryFor({ "org-1": true });

    await repository.findUserBindings({
      organizationId: "org-1",
      userId: "alice",
    });
    const rows = await repository.findOrganizationBindings({
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
    await repository.findUserCreatedRoles({ organizationId: "org-1" });

    expect(rows).toEqual([{ id: "row-from-eventing" }]);
    expect(eventing.findUserBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findOrganizationBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findUserAndGroupBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findScopeBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findGroupBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findTeamMemberBindings).toHaveBeenCalledTimes(1);
    expect(eventing.findUserCreatedRoles).toHaveBeenCalledTimes(1);
    expect(legacy.findOrganizationBindings).not.toHaveBeenCalled();
  });

  it("routes listings to the legacy head before cutover", async () => {
    const { legacy, eventing, repository } = repositoryFor({ "org-1": false });

    const rows = await repository.findOrganizationBindings({
      organizationId: "org-1",
    });
    await repository.findUserCreatedRoles({ organizationId: "org-1" });

    expect(rows).toEqual([{ id: "row-from-legacy" }]);
    expect(legacy.findOrganizationBindings).toHaveBeenCalledTimes(1);
    expect(legacy.findUserCreatedRoles).toHaveBeenCalledTimes(1);
    expect(eventing.findOrganizationBindings).not.toHaveBeenCalled();
  });

  it("partitions a multi-organization synthesis read by selected head", async () => {
    const { legacy, eventing, repository } = repositoryFor({
      "org-eventing": true,
      "org-legacy": false,
    });

    const rows = await repository.findBindingsForSynthesis({
      orgIds: ["org-eventing", "org-legacy"],
      userId: "alice",
    });

    expect(legacy.findBindingsForSynthesis).toHaveBeenCalledWith({
      orgIds: ["org-legacy"],
      userId: "alice",
    });
    expect(eventing.findBindingsForSynthesis).toHaveBeenCalledWith({
      orgIds: ["org-eventing"],
      userId: "alice",
    });
    expect(
      (rows as unknown as Array<{ organizationId: string; head: string }>).map(
        ({ organizationId, head }) => ({ organizationId, head }),
      ),
    ).toEqual([
      { organizationId: "org-legacy", head: "legacy" },
      { organizationId: "org-eventing", head: "eventing" },
    ]);
  });

  it("observes a rollback on the next listing call", async () => {
    const legacy = spyRepository("legacy");
    const eventing = spyRepository("eventing");
    const selectHead = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const repository = RoutedAuthzListingRepository.create({
      database: {} as AuthzDatabase,
      selectHead,
      repositories: { legacy, eventing },
    });

    await repository.findOrganizationBindings({ organizationId: "org-1" });
    await repository.findOrganizationBindings({ organizationId: "org-1" });

    expect(eventing.findOrganizationBindings).toHaveBeenCalledTimes(1);
    expect(legacy.findOrganizationBindings).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GrantsService,
  GrantValidationError,
  OffboardIncompleteError,
} from "../grants.service";
import {
  type AuthzGrantsRepository,
  DuplicateBindingError,
} from "../authz-grants.repository";
import type { AuthzReadRepository } from "../authz-read.repository";

const ORG = "org-1";
const TEAM = "team-1";

type RepositoryStub = {
  [K in keyof AuthzGrantsRepository]: ReturnType<typeof vi.fn>;
};

/** A read repository whose every method resolves empty - the post-offboard
 *  world. Individual tests override what should still resolve. */
function makeEmptyReader(
  overrides: Partial<AuthzReadRepository> = {},
): AuthzReadRepository {
  return {
    findOrganizationRole: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const OFFBOARD_COUNTS = {
  bindings: 2,
  groupMemberships: 1,
  legacyTeamMemberships: 1,
  pendingInvites: 0,
  organizationMembership: true,
};

function makeRepository(
  overrides: Partial<RepositoryStub> = {},
): RepositoryStub {
  return {
    createBinding: vi.fn().mockResolvedValue(undefined),
    updateBindingRole: vi.fn().mockResolvedValue(undefined),
    deleteBinding: vi.fn().mockResolvedValue(undefined),
    findBinding: vi.fn().mockResolvedValue({ id: "rb-1", organizationId: ORG }),
    findCustomRoleOrganization: vi
      .fn()
      .mockResolvedValue({ organizationId: ORG }),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    replaceBinding: vi.fn().mockResolvedValue(undefined),
    findUserEmail: vi.fn().mockResolvedValue("dave@acme.test"),
    // The real adapter runs the deletes in a transaction and calls prove()
    // with a transaction-bound reader; the stub mirrors that contract - a
    // throw from prove() rejects the whole call, like a rollback.
    offboardUser: vi.fn(async ({ prove }) => {
      await prove(makeEmptyReader());
      return OFFBOARD_COUNTS;
    }),
    findOwnedApiKeys: vi.fn().mockResolvedValue([]),
    findPersonalTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const actor = { userId: "admin-1" };

function makeService(repository: RepositoryStub) {
  const audit = vi.fn().mockResolvedValue(undefined);
  const bumpEpoch = vi.fn().mockResolvedValue(undefined);
  const service = new GrantsService(
    repository as unknown as AuthzGrantsRepository,
    { audit, newBindingId: () => "rb_test_ksuid", bumpEpoch },
  );
  return { service, audit, bumpEpoch };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GrantsService.attach", () => {
  describe("when attaching a built-in role at team scope", () => {
    it("creates the binding row and bumps the org epoch", async () => {
      const repository = makeRepository();
      const { service, audit, bumpEpoch } = makeService(repository);

      const result = await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { builtin: "VIEWER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
      });

      expect(result.bindingId).toBe("rb_test_ksuid");
      expect(repository.createBinding).toHaveBeenCalledWith({
        bindingId: "rb_test_ksuid",
        organizationId: ORG,
        scopeType: "TEAM",
        scopeId: TEAM,
        role: "VIEWER",
        customRoleId: null,
        userId: "alice",
        groupId: null,
        apiKeyId: null,
      });
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.attach" }),
      );
    });
  });

  describe("when the custom role belongs to another organization", () => {
    it("rejects the attach", async () => {
      const repository = makeRepository({
        findCustomRoleOrganization: vi
          .fn()
          .mockResolvedValue({ organizationId: "org-other" }),
      });
      const { service } = makeService(repository);

      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "alice" },
          role: { customRoleId: "cr-foreign" },
          where: { type: "organization", id: ORG },
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
      expect(repository.createBinding).not.toHaveBeenCalled();
    });
  });

  describe("when the team is not in the target organization", () => {
    it("rejects the attach", async () => {
      const repository = makeRepository({
        findTeamOrganization: vi
          .fn()
          .mockResolvedValue({ organizationId: "org-other" }),
      });
      const { service } = makeService(repository);

      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "alice" },
          role: { builtin: "MEMBER" },
          where: { type: "team", id: TEAM, organizationId: ORG },
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });
  });

  describe("when the scope already holds an identical binding", () => {
    /** @scenario "Attaching a duplicate role binding is rejected with a named error" */
    it("names the duplicate the repository surfaced", async () => {
      const repository = makeRepository({
        createBinding: vi.fn().mockRejectedValue(new DuplicateBindingError()),
      });
      const { service, bumpEpoch } = makeService(repository);
      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "user-1" },
          role: { builtin: "MEMBER" },
          where: { type: "team", id: TEAM, organizationId: ORG },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });
});

describe("GrantsService.revoke", () => {
  describe("when revoking an existing binding", () => {
    /** @scenario "Revoking a binding takes effect on the caller's next request" */
    it("deletes the row and bumps the epoch so the next check recollects", async () => {
      const repository = makeRepository();
      const { service, audit, bumpEpoch } = makeService(repository);
      await service.revoke({ actor, bindingId: "rb-1" });
      expect(repository.deleteBinding).toHaveBeenCalledWith({
        bindingId: "rb-1",
      });
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.revoke" }),
      );
    });
  });
});

describe("GrantsService.update", () => {
  describe("when the role change collides with a sibling binding", () => {
    it("names the duplicate the repository surfaced", async () => {
      const repository = makeRepository({
        updateBindingRole: vi
          .fn()
          .mockRejectedValue(new DuplicateBindingError()),
      });
      const { service, bumpEpoch } = makeService(repository);
      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          role: { builtin: "MEMBER" },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });

  describe("when re-pointing at another organization's custom role", () => {
    /** @scenario "A role binding can never reference another organization's custom role" */
    it("rejects with the same tenancy rule as attach", async () => {
      const repository = makeRepository({
        findCustomRoleOrganization: vi
          .fn()
          .mockResolvedValue({ organizationId: "org-other" }),
      });
      const { service } = makeService(repository);
      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          role: { customRoleId: "cr-foreign" },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(repository.updateBindingRole).not.toHaveBeenCalled();
    });
  });
});

describe("GrantsService.replace", () => {
  describe("when narrowing an org grant to a team grant", () => {
    /** @scenario "Replacing a grant is one atomic swap" */
    it("hands the repository one atomic swap, with one audit record", async () => {
      const repository = makeRepository();
      const { service, audit, bumpEpoch } = makeService(repository);
      const result = await service.replace({
        actor,
        who: { type: "user", id: "user-1" },
        from: { type: "organization", id: ORG },
        to: { type: "team", id: TEAM, organizationId: ORG },
        role: { builtin: "MEMBER" },
      });
      expect(result.bindingId).toBe("rb_test_ksuid");
      expect(repository.replaceBinding).toHaveBeenCalledTimes(1);
      expect(repository.replaceBinding).toHaveBeenCalledWith({
        deleteWhere: {
          organizationId: ORG,
          scopeType: "ORGANIZATION",
          scopeId: ORG,
          principal: { userId: "user-1" },
        },
        create: expect.objectContaining({
          bindingId: "rb_test_ksuid",
          scopeType: "TEAM",
          scopeId: TEAM,
          role: "MEMBER",
        }),
      });
      expect(repository.createBinding).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.replace" }),
      );
      expect(bumpEpoch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GrantsService.offboard", () => {
  describe("when every grant source deletes cleanly", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("returns the removal counts, the manifest, and bumps the epoch", async () => {
      const repository = makeRepository({
        findOwnedApiKeys: vi
          .fn()
          .mockResolvedValue([{ id: "key-1", name: "ci key" }]),
        findPersonalTeams: vi
          .fn()
          .mockResolvedValue([{ id: "team-p", name: "Dave's workspace" }]),
      });
      const { service, audit, bumpEpoch } = makeService(repository);

      const result = await service.offboard({
        actor,
        userId: "dave",
        organizationId: ORG,
      });

      expect(result.removed).toEqual(OFFBOARD_COUNTS);
      expect(result.needsHumanDecision.ownedApiKeys).toEqual([
        { id: "key-1", name: "ci key" },
      ]);
      expect(result.needsHumanDecision.personalTeams).toEqual([
        { id: "team-p", name: "Dave's workspace" },
      ]);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "authz.grants.offboard" }),
      );
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });

  describe("when something still resolves after the deletes", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("throws from the proof and the transaction rolls back", async () => {
      const repository = makeRepository({
        // The transaction-bound reader still sees a binding - the proof
        // must throw, and the adapter contract turns that into a rollback.
        offboardUser: vi.fn(async ({ prove }) => {
          await prove(
            makeEmptyReader({
              findUserBindings: vi.fn().mockResolvedValue([
                {
                  role: "MEMBER",
                  customRoleId: null,
                  scopeType: "TEAM",
                  scopeId: TEAM,
                  viaGroupId: null,
                },
              ]),
            }),
          );
          return OFFBOARD_COUNTS;
        }),
      });
      const { service, bumpEpoch } = makeService(repository);

      await expect(
        service.offboard({ actor, userId: "dave", organizationId: ORG }),
      ).rejects.toBeInstanceOf(OffboardIncompleteError);
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });
});

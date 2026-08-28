import { SYSTEM_ACTORS } from "@langwatch/actor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import {
  type AuthzGrantsRepository,
  BindingMissingError,
  type BindingPrincipalWhere,
  DuplicateBindingError,
} from "../authz-grants.repository";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService } from "../authz.service";
import { GrantValidationError } from "../grant-validation";
import { GrantsService } from "../grants.service";
import { GRANT_EVENT_SOURCES } from "../ledger/facts";
import { OffboardIncompleteError } from "../offboard";
import { makeReader } from "./support/authz-read.stub";

const ORG = "org-1";
const OTHER_ORG = "org-other";
const TEAM = "team-1";
const PROJECT = "proj-1";

type RepositoryStub = {
  [K in keyof AuthzGrantsRepository]: ReturnType<typeof vi.fn>;
};

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
    findCustomRole: vi
      .fn()
      .mockResolvedValue({ organizationId: ORG, permissions: ["traces:view"] }),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    replaceBinding: vi.fn().mockResolvedValue(undefined),
    // The real adapter runs the deletes in a transaction and calls prove()
    // with a transaction-bound reader; the stub mirrors that contract - a
    // throw from prove() rejects the whole call, like a rollback.
    offboardUser: vi.fn(async ({ prove }) => {
      await prove(makeReader());
      return OFFBOARD_COUNTS;
    }),
    findOwnedApiKeys: vi.fn().mockResolvedValue([]),
    findPersonalTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const actor = { userId: "admin-1" };

const WRITE_ACTOR = { type: "user", id: "admin-1" };

function makeService(repository: RepositoryStub) {
  const bumpEpoch = vi.fn().mockResolvedValue(undefined);
  const service = new GrantsService(
    repository as unknown as AuthzGrantsRepository,
    {
      newBindingId: () => "rb_test_ksuid",
      bumpEpoch,
      collectorFor: (reader: AuthzReadRepository) =>
        new AuthzCollectorService(reader),
    },
  );
  return { service, bumpEpoch };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GrantsService.attach", () => {
  describe("when attaching a built-in role at team scope", () => {
    it("creates the binding row and bumps the org epoch", async () => {
      const repository = makeRepository();
      const { service, bumpEpoch } = makeService(repository);

      const result = await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { builtin: "VIEWER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
      });

      expect(result.bindingId).toBe("rb_test_ksuid");
      expect(repository.createBinding).toHaveBeenCalledWith({
        row: {
          bindingId: "rb_test_ksuid",
          organizationId: ORG,
          scopeType: "TEAM",
          scopeId: TEAM,
          role: "VIEWER",
          customRoleId: null,
          principal: { userId: "alice" },
        },
        actor: WRITE_ACTOR,
        source: "grants-service",
      });
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });

  describe("when the custom role belongs to another organization", () => {
    it("rejects the attach", async () => {
      const repository = makeRepository({
        findCustomRole: vi
          .fn()
          .mockResolvedValue({ organizationId: OTHER_ORG, permissions: [] }),
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

  describe("when the custom role lists a permission the registry never heard of", () => {
    it("rejects the attach and names the offending strings", async () => {
      const repository = makeRepository({
        findCustomRole: vi.fn().mockResolvedValue({
          organizationId: ORG,
          permissions: ["traces:view", "traces:teleport"],
        }),
      });
      const { service } = makeService(repository);

      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "alice" },
          role: { customRoleId: "cr-typo" },
          where: { type: "team", id: TEAM, organizationId: ORG },
        }),
      ).rejects.toMatchObject({
        code: "grant_validation_failed",
        meta: { unknownPermissions: ["traces:teleport"] },
      });
      expect(repository.createBinding).not.toHaveBeenCalled();
    });
  });

  describe("when the custom role's payload is not a list at all", () => {
    it("attaches, because a malformed payload grants nothing to validate", async () => {
      const repository = makeRepository({
        findCustomRole: vi
          .fn()
          .mockResolvedValue({ organizationId: ORG, permissions: null }),
      });
      const { service } = makeService(repository);

      await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { customRoleId: "cr-empty" },
        where: { type: "team", id: TEAM, organizationId: ORG },
      });

      expect(repository.createBinding).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the caller states where the grant came from", () => {
    /** @scenario "A grant states which surface authored it" */
    it("stamps that source onto the write", async () => {
      const repository = makeRepository();
      const { service } = makeService(repository);

      await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { builtin: "MEMBER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
        source: "join-request",
      });

      expect(repository.createBinding).toHaveBeenCalledWith(
        expect.objectContaining({ source: "join-request" }),
      );
    });

    /** Every vocabulary entry reaches the port unchanged: the seam is the
     *  vocabulary's, not a private list of the two callers that exist today.
     *  @scenario "A grant states which surface authored it" */
    it("carries every source the vocabulary names", async () => {
      for (const source of GRANT_EVENT_SOURCES) {
        const repository = makeRepository();
        const { service } = makeService(repository);

        await service.attach({
          actor,
          who: { type: "user", id: "alice" },
          role: { builtin: "MEMBER" },
          where: { type: "team", id: TEAM, organizationId: ORG },
          source,
        });

        expect(repository.createBinding).toHaveBeenCalledWith(
          expect.objectContaining({ source }),
        );
      }
    });
  });

  describe("when the caller states no source", () => {
    /** @scenario "A grant nobody attributed is the grants service's own" */
    it("attributes the grant to the grants service", async () => {
      const repository = makeRepository();
      const { service } = makeService(repository);

      await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { builtin: "MEMBER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
      });

      expect(repository.createBinding).toHaveBeenCalledWith(
        expect.objectContaining({ source: "grants-service" }),
      );
    });
  });

  describe("when the caller is a surface rather than a person", () => {
    /** The registry's name, never a hand-built `"system:..."` string: what
     *  reaches the port is what `toLedgerActor` renders it as.
     *  @scenario "A write with no person behind it names the surface that made it" */
    it("stamps the registry's system principal onto the write", async () => {
      const repository = makeRepository();
      const { service } = makeService(repository);

      await service.attach({
        actor: { type: "system", name: "scim" },
        who: { type: "user", id: "alice" },
        role: { builtin: "MEMBER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
        source: "scim",
      });

      expect(repository.createBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { type: "system", id: SYSTEM_ACTORS.scim },
          source: "scim",
        }),
      );
    });

    /** @scenario "A write with no person behind it names the surface that made it" */
    it("carries the join-requests principal the auto-approval path acts as", async () => {
      const repository = makeRepository();
      const { service } = makeService(repository);

      await service.attach({
        actor: { type: "system", name: "joinRequests" },
        who: { type: "user", id: "alice" },
        role: { builtin: "MEMBER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
        source: "join-request",
      });

      expect(repository.createBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
          source: "join-request",
        }),
      );
    });

    /** The raw-id shape every boundary already passes is untouched by the
     *  widening — that is the whole constraint on this change.
     *  @scenario "A write with no person behind it names the surface that made it" */
    it("still records a person from the raw id shape", async () => {
      const repository = makeRepository();
      const { service } = makeService(repository);

      await service.attach({
        actor,
        who: { type: "user", id: "alice" },
        role: { builtin: "MEMBER" },
        where: { type: "team", id: TEAM, organizationId: ORG },
      });

      expect(repository.createBinding).toHaveBeenCalledWith(
        expect.objectContaining({ actor: WRITE_ACTOR }),
      );
    });
  });

  describe("when the team is not in the target organization", () => {
    it("rejects the attach", async () => {
      const repository = makeRepository({
        findTeamOrganization: vi
          .fn()
          .mockResolvedValue({ organizationId: OTHER_ORG }),
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
    it("answers the REST contract's own conflict code, not a generic validation failure", async () => {
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
      ).rejects.toMatchObject({
        code: "role_binding_already_exists",
        httpStatus: 409,
      });
      expect(bumpEpoch).not.toHaveBeenCalled();
    });

    /** @scenario "Attaching a duplicate role binding is rejected with a named error" */
    it("matches the port signal by code, not by class identity", async () => {
      // Not a `DuplicateBindingError` instance - e.g. what a port adapter
      // reconstructs from a serialised error crossing a worker or a bundle
      // boundary. `rethrowKnownWriteFailure` must still translate it.
      const repository = makeRepository({
        createBinding: vi
          .fn()
          .mockRejectedValue({ code: "role_binding_already_exists" }),
      });
      const { service, bumpEpoch } = makeService(repository);
      await expect(
        service.attach({
          actor,
          who: { type: "user", id: "user-1" },
          role: { builtin: "MEMBER" },
          where: { type: "team", id: TEAM, organizationId: ORG },
        }),
      ).rejects.toMatchObject({
        code: "role_binding_already_exists",
        httpStatus: 409,
      });
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });
});

describe("GrantsService.revoke", () => {
  describe("when revoking an existing binding", () => {
    /** @scenario "Revoking a binding takes effect on the caller's next request" */
    it("deletes the row and bumps the epoch so the next check recollects", async () => {
      const repository = makeRepository();
      const { service, bumpEpoch } = makeService(repository);
      await service.revoke({ actor, bindingId: "rb-1", organizationId: ORG });
      expect(repository.deleteBinding).toHaveBeenCalledWith({
        bindingId: "rb-1",
        organizationId: ORG,
        actor: WRITE_ACTOR,
      });
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });

  describe("when the binding belongs to another organization", () => {
    it("answers not-found rather than confirming it exists", async () => {
      const repository = makeRepository({
        findBinding: vi
          .fn()
          .mockResolvedValue({ id: "rb-1", organizationId: OTHER_ORG }),
      });
      const { service } = makeService(repository);

      await expect(
        service.revoke({ actor, bindingId: "rb-1", organizationId: ORG }),
      ).rejects.toMatchObject({
        code: "grant_validation_failed",
        message: "Role binding not found",
      });
      expect(repository.deleteBinding).not.toHaveBeenCalled();
    });
  });

  describe("when the row disappears between the read and the delete", () => {
    it("answers with the same not-found the pre-read produces", async () => {
      const repository = makeRepository({
        deleteBinding: vi.fn().mockRejectedValue(new BindingMissingError()),
      });
      const { service, bumpEpoch } = makeService(repository);

      await expect(
        service.revoke({ actor, bindingId: "rb-1", organizationId: ORG }),
      ).rejects.toMatchObject({
        code: "grant_validation_failed",
        message: "Role binding not found",
      });
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });

});

describe("GrantsService.update", () => {
  describe("when the role change collides with a sibling binding", () => {
    it("answers the REST contract's own conflict code", async () => {
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
          organizationId: ORG,
          role: { builtin: "MEMBER" },
        }),
      ).rejects.toMatchObject({
        code: "role_binding_already_exists",
        httpStatus: 409,
      });
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });

  describe("when re-pointing at another organization's custom role", () => {
    /** @scenario "A role binding can never reference another organization's custom role" */
    it("rejects with the same tenancy rule as attach", async () => {
      const repository = makeRepository({
        findCustomRole: vi
          .fn()
          .mockResolvedValue({ organizationId: OTHER_ORG, permissions: [] }),
      });
      const { service } = makeService(repository);
      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          organizationId: ORG,
          role: { customRoleId: "cr-foreign" },
        }),
      ).rejects.toMatchObject({ code: "grant_validation_failed" });
      expect(repository.updateBindingRole).not.toHaveBeenCalled();
    });
  });

  describe("when re-pointing at a custom role with an unknown permission", () => {
    it("rejects with the same vocabulary rule as attach", async () => {
      const repository = makeRepository({
        findCustomRole: vi.fn().mockResolvedValue({
          organizationId: ORG,
          permissions: ["definitely:notreal"],
        }),
      });
      const { service } = makeService(repository);
      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          organizationId: ORG,
          role: { customRoleId: "cr-typo" },
        }),
      ).rejects.toMatchObject({
        code: "grant_validation_failed",
        meta: { unknownPermissions: ["definitely:notreal"] },
      });
      expect(repository.updateBindingRole).not.toHaveBeenCalled();
    });
  });

  describe("when the binding belongs to another organization", () => {
    it("answers not-found rather than confirming it exists", async () => {
      const repository = makeRepository({
        findBinding: vi
          .fn()
          .mockResolvedValue({ id: "rb-1", organizationId: OTHER_ORG }),
      });
      const { service } = makeService(repository);

      await expect(
        service.update({
          actor,
          bindingId: "rb-1",
          organizationId: ORG,
          role: { builtin: "MEMBER" },
        }),
      ).rejects.toMatchObject({
        code: "grant_validation_failed",
        message: "Role binding not found",
      });
      expect(repository.updateBindingRole).not.toHaveBeenCalled();
    });
  });
});

describe("GrantsService.replace", () => {
  describe("when narrowing an org grant to a team grant", () => {
    /** @scenario "Replacing a grant is one atomic swap" */
    it("hands the repository one swap carrying the actor", async () => {
      const repository = makeRepository();
      const { service, bumpEpoch } = makeService(repository);
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
          principal: { userId: "user-1" },
        }),
        actor: WRITE_ACTOR,
      });
      expect(repository.createBinding).not.toHaveBeenCalled();
      expect(bumpEpoch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GrantsService.offboard", () => {
  describe("when every grant source deletes cleanly", () => {
    it("returns the removal counts, the manifest, and bumps the epoch", async () => {
      const repository = makeRepository({
        findOwnedApiKeys: vi
          .fn()
          .mockResolvedValue([{ id: "key-1", name: "ci key" }]),
        findPersonalTeams: vi
          .fn()
          .mockResolvedValue([{ id: "team-p", name: "Dave's workspace" }]),
      });
      const { service, bumpEpoch } = makeService(repository);

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
      expect(repository.offboardUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "dave",
          organizationId: ORG,
          actor: WRITE_ACTOR,
        }),
      );
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });

  describe("when a directory sync offboards the member", () => {
    /** D08's de-enroll. The revocation says which surface removed the
     *  member through its ACTOR — `grant_revoked` has no `source` field and
     *  does not need one, because the offboarding fact already names the
     *  surface here and the reason alongside it.
     *  @scenario "A revocation names the surface that made it without a source of its own" */
    it("hands the port the surface as the offboarding actor", async () => {
      const repository = makeRepository();
      const { service } = makeService(repository);

      await service.offboard({
        actor: { type: "system", name: "scim" },
        userId: "dave",
        organizationId: ORG,
      });

      expect(repository.offboardUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "dave",
          actor: { type: "system", id: SYSTEM_ACTORS.scim },
        }),
      );
    });
  });

  describe("when something still resolves after the deletes", () => {
    it("throws from the proof and leaves storage untouched", async () => {
      const repository = makeRepository({
        // The transaction-bound reader still sees a binding - the proof
        // must throw, and the adapter contract turns that into a rollback.
        offboardUser: vi.fn(async ({ prove }) => {
          await prove(
            makeReader({
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

  describe("given the offboarded user still owns a personal api key", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("resolves nothing through the key, because its owner now resolves nothing", async () => {
      // The post-offboard world: the KEY's own binding survived the
      // offboarding (nobody deleted the key), but its owner has nothing
      // left, and the §9 ceiling is what closes the hole.
      const authz = new AuthzService(
        new AuthzCollectorService(
          makeReader({
            findApiKeyOwner: vi.fn().mockResolvedValue({ userId: "dave" }),
            findApiKeyBindings: vi.fn().mockResolvedValue([
              {
                role: "ADMIN",
                customRoleId: null,
                scopeType: "PROJECT",
                scopeId: PROJECT,
                viaGroupId: null,
              },
            ]),
          }),
        ),
      );

      const decision = await authz.check({
        principal: { type: "apiKey", id: "key-1" },
        permission: "datasets:manage",
        scope: {
          type: "project",
          id: PROJECT,
          teamId: TEAM,
          organizationId: ORG,
        },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("owner-ceiling");
    });
  });
});

describe("BindingPrincipalWhere", () => {
  it("rejects a value carrying two principals, even passed by reference", () => {
    // Excess-property checks skip variables, so without the `?: never`
    // exclusions this assignment would type-check and the adapter would
    // write two principal columns onto one row.
    const twoPrincipals = { userId: "user-1", groupId: "group-1" };
    // @ts-expect-error exactly one principal per binding row
    const rejected: BindingPrincipalWhere = twoPrincipals;
    void rejected;

    const user: BindingPrincipalWhere = { userId: "user-1" };
    const group: BindingPrincipalWhere = { groupId: "group-1" };
    const apiKey: BindingPrincipalWhere = { apiKeyId: "key-1" };
    expect([user, group, apiKey]).toHaveLength(3);
  });
});

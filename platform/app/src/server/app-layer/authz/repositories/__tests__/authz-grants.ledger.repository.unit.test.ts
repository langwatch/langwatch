/**
 * The ledger-backed write port keeps the two typed failures the port
 * documents (ADR-092 §13, `@throws` on `AuthzGrantsRepository`).
 *
 * The parent class raised them from its own Prisma calls; this one writes
 * through the ledger writer and synchronous revocation enforcement, which can
 * surface a duplicate or missing-row signal. Anything
 * that escapes as a raw Prisma error degrades to an unknown 500 at the
 * boundary, which silently breaks the REST contract's 409 and 404 — so every
 * mapping is asserted here, by `code`, because that is how callers match.
 *
 * Offboarding rides along: it is the one write whose correctness is a
 * POSTCONDITION rather than a shape, so what it enumerates and what it proves
 * against are the two things worth pinning.
 */
import type { LedgerActor } from "@langwatch/actor";
import type { AuthzReadRepository } from "@langwatch/authz-server";
import {
  BindingMissingError,
  DuplicateBindingError,
  grantFactToRow,
} from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "../../ledger";
import { LedgerAuthzGrantsRepository } from "../authz-grants.ledger.repository";
import { GrantsAuthzReadRepository } from "../authz-read.grants.repository";

const ORG_ID = "org_ledger";
const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

function prismaError(code: string): Error {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

function grantRow(id = "rb_1") {
  return {
    ...grantFactToRow({
      organizationId: ORG_ID,
      grant: {
        grantId: id,
        principal: { type: "user", id: "user_sam" },
        roleKey: "member",
        legacyRole: TeamUserRole.MEMBER,
        scope: { type: RoleBindingScopeType.TEAM, id: "team_support" },
        source: "grants-service",
        occurredAtMs: 0,
      },
    }),
    updatedAt: new Date(0),
  };
}

function resourceGrantRow(id = "share_1") {
  return {
    ...grantFactToRow({
      organizationId: ORG_ID,
      grant: {
        grantId: id,
        principal: { type: "anyone", id: null },
        roleKey: null,
        scope: { type: "RESOURCE", id: "trace_1" },
        resource: {
          kind: "trace",
          projectId: "project_1",
          token: "token_1",
          permission: "traces:view",
        },
        source: "grants-service",
        occurredAtMs: 0,
      },
    }),
    updatedAt: new Date(0),
  };
}

function harness(writerOverrides: Partial<GrantsLedgerWriter> = {}) {
  const db = {
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue({ id: "rb_1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    grant: {
      findFirst: vi.fn().mockResolvedValue(grantRow()),
      findMany: vi.fn().mockResolvedValue([grantRow()]),
    },
  };
  const writer = {
    attachBindings: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
    changeBindingRole: vi.fn().mockResolvedValue(undefined),
    revokeBindings: vi.fn().mockResolvedValue(undefined),
    revokeBindingsWhere: vi.fn().mockResolvedValue(1),
    offboardMember: vi.fn().mockResolvedValue(undefined),
    ...writerOverrides,
  } as unknown as GrantsLedgerWriter;
  return {
    db,
    writer,
    repository: new LedgerAuthzGrantsRepository(
      db as unknown as PrismaClient,
      writer,
    ),
  };
}

const binding = {
  bindingId: "rb_1",
  organizationId: ORG_ID,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: "team_support",
  role: TeamUserRole.MEMBER,
  customRoleId: null,
  principal: { userId: "user_sam" },
};

describe("given a create that collides with an identical binding", () => {
  describe("when the writer raises the port's own duplicate", () => {
    it("lets it through, so the caller keeps its 409", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(new DuplicateBindingError()),
      } as Partial<GrantsLedgerWriter>);

      await expect(
        repository.createBinding({ row: binding, actor: ACTOR }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });

  describe("when the collision escapes as a raw unique violation", () => {
    it("maps it onto the port's duplicate rather than an unknown 500", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(prismaError("P2002")),
      } as Partial<GrantsLedgerWriter>);

      await expect(
        repository.createBinding({ row: binding, actor: ACTOR }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });
});

describe("given a grant id that is not a role binding", () => {
  it("does not expose a resource grant through the binding port", async () => {
    const { db, repository } = harness();
    db.grant.findFirst.mockResolvedValueOnce(resourceGrantRow());

    await expect(
      repository.findBinding({ bindingId: "share_1" }),
    ).resolves.toBe(null);
  });
});

describe("given a role change on a row that is gone", () => {
  describe("when the writer raises Prisma's missing-record error", () => {
    it("maps it onto the port's missing binding, so the caller keeps its 404", async () => {
      const { repository } = harness({
        changeBindingRole: vi.fn().mockRejectedValue(prismaError("P2025")),
      } as Partial<GrantsLedgerWriter>);

      await expect(
        repository.updateBindingRole({
          bindingId: "rb_1",
          organizationId: ORG_ID,
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "role_binding_not_found" });
    });
  });

  describe("when a sibling already holds the target role", () => {
    it("keeps the duplicate answer", async () => {
      const { repository } = harness({
        changeBindingRole: vi
          .fn()
          .mockRejectedValue(new DuplicateBindingError()),
      } as Partial<GrantsLedgerWriter>);

      await expect(
        repository.updateBindingRole({
          bindingId: "rb_1",
          organizationId: ORG_ID,
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });
});

describe("given a delete for a binding that is not there", () => {
  describe("when the pre-read finds nothing", () => {
    it("answers the port's missing binding rather than a silent no-op", async () => {
      const { db, repository } = harness();
      db.grant.findMany.mockResolvedValueOnce([]);

      await expect(
        repository.deleteBinding({
          bindingId: "rb_1",
          organizationId: ORG_ID,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "role_binding_not_found" });
    });
  });
});

describe("given a replace whose broad grant has already gone", () => {
  describe("when the existence pre-read finds nothing", () => {
    it("answers the port's missing binding and never revokes or attaches anything", async () => {
      const { db, repository, writer } = harness();
      db.grant.findMany.mockResolvedValueOnce([]);

      await expect(
        repository.replaceBinding({
          deleteWhere: {
            organizationId: ORG_ID,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team_support",
            principal: { userId: "user_sam" },
          },
          create: binding,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "role_binding_not_found" });
      expect(writer.revokeBindingsWhere).not.toHaveBeenCalled();
      expect(writer.attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the fold is lagging behind a grant that landed moments ago", () => {
    /**
     * The existence pre-read found the row (it is genuinely there), but the
     * lagging compat projection `revokeBindingsWhere` itself reads from can
     * still answer 0 — its own docstring calls that count advisory. The old
     * code derived "missing" from that count AFTER already appending a
     * selector-only revoke, so the grant was swept away by the fold while
     * the caller was told there was nothing to replace. The fix moves the
     * existence check earlier, so this case now completes the replace
     * instead of destroying access while reporting failure.
     */
    it("still completes the replace rather than appending a revoke and reporting missing", async () => {
      const { repository, writer } = harness({
        revokeBindingsWhere: vi.fn().mockResolvedValue(0),
      } as Partial<GrantsLedgerWriter>);

      await repository.replaceBinding({
        deleteWhere: {
          organizationId: ORG_ID,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_support",
          principal: { userId: "user_sam" },
        },
        create: binding,
        actor: ACTOR,
      });

      expect(writer.revokeBindingsWhere).toHaveBeenCalledTimes(1);
      expect(writer.attachBindings).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a write that failed for a reason the caller cannot act on", () => {
  describe("when the writer raises an infrastructure error", () => {
    it("passes it through untouched, so it degrades to unknown with its trace id", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(new Error("redis is down")),
      } as Partial<GrantsLedgerWriter>);

      const error = await repository
        .createBinding({ row: binding, actor: ACTOR })
        .catch((raised: unknown) => raised);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DuplicateBindingError);
      expect(error).not.toBeInstanceOf(BindingMissingError);
      expect((error as { code?: string }).code).toBeUndefined();
    });
  });
});

const OFFBOARD_ORG_ID = "organization_offboard_1";
const OFFBOARD_USER_ID = "user_offboard_1";

function buildRepository({
  bindingIds,
  grantIds,
  survivingGrantRows = 0,
  activeAdminIds = ["user_other_admin"],
  membershipPresent = true,
}: {
  bindingIds: string[];
  grantIds: string[];
  /** Grant-head rows still present INSIDE the transaction - the shape of a
   *  revocation that never actually landed. */
  survivingGrantRows?: number;
  activeAdminIds?: string[];
  membershipPresent?: boolean;
}) {
  const tx = {
    roleBinding: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    groupMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    team: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    project: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    teamUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    organizationUser: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: "gone@example.com" }),
    },
    organizationInvite: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    grant: {
      findMany: vi.fn().mockResolvedValue(grantIds.map((id) => ({ id }))),
      count: vi.fn().mockResolvedValue(survivingGrantRows),
    },
    $queryRaw: vi.fn(),
  };
  let queryNumber = 0;
  tx.$queryRaw.mockImplementation(() => {
    queryNumber += 1;
    const queryInTransaction = queryNumber % 3;
    if (queryInTransaction === 1) return [{ id: OFFBOARD_ORG_ID }];
    if (queryInTransaction === 2) {
      return activeAdminIds.map((userId) => ({ userId }));
    }
    return membershipPresent ? [{ userId: OFFBOARD_USER_ID }] : [];
  });
  const roleBindingFindMany = vi
    .fn()
    .mockResolvedValue(bindingIds.map((id) => ({ id })));
  const prisma = {
    roleBinding: { findMany: roleBindingFindMany },
    $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient;
  const offboardMember = vi.fn().mockResolvedValue(undefined);
  const revokeBindingsWhere = vi.fn().mockResolvedValue(0);
  const writer = {
    offboardMember,
    revokeBindingsWhere,
  } as unknown as GrantsLedgerWriter;
  return {
    repository: new LedgerAuthzGrantsRepository(prisma, writer),
    offboardMember,
    revokeBindingsWhere,
    grantFindMany: tx.grant.findMany,
    tx,
  };
}

describe("given a member being offboarded", () => {
  describe("when the membership disappeared before the transaction", () => {
    it("revokes stale grants and preserves member_not_found", async () => {
      const { repository, revokeBindingsWhere, tx } = buildRepository({
        bindingIds: [],
        grantIds: [],
        membershipPresent: false,
      });

      await expect(
        repository.offboardUser({
          userId: OFFBOARD_USER_ID,
          organizationId: OFFBOARD_ORG_ID,
          actor: ACTOR,
          prove: async () => undefined,
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });

      expect(revokeBindingsWhere).toHaveBeenCalledWith({
        organizationId: OFFBOARD_ORG_ID,
        where: { userId: OFFBOARD_USER_ID },
        actor: ACTOR,
        reason: "organization membership removed",
      });
      expect(tx.organizationUser.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the user holds facts on both heads", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("revokes every live grant head, including grants without a compat row", async () => {
      const { repository, offboardMember, grantFindMany } = buildRepository({
        bindingIds: ["shared-1", "compat-only-2"],
        // Compatibility rows are deliberately ignored by the authoritative
        // offboarding path; this also proves a Grant-only fact is included.
        grantIds: ["shared-1", "lite-member-3"],
      });

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async () => undefined,
      });

      expect(grantFindMany).toHaveBeenCalledWith({
        where: {
          organizationId: OFFBOARD_ORG_ID,
          principalType: "USER",
          principalId: OFFBOARD_USER_ID,
          revokedAt: null,
        },
        select: { id: true },
      });
      expect(offboardMember).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: OFFBOARD_ORG_ID,
          userId: OFFBOARD_USER_ID,
          revokedGrantIds: ["shared-1", "lite-member-3"],
        }),
      );
    });
  });

  describe("when the member owns a personal workspace", () => {
    it("archives its project and team in the offboard transaction", async () => {
      const { repository, tx } = buildRepository({
        bindingIds: [],
        grantIds: [],
      });
      tx.team.findMany.mockResolvedValue([{ id: "personal-team" }]);

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async () => undefined,
      });

      expect(tx.project.updateMany).toHaveBeenCalledWith({
        where: {
          teamId: { in: ["personal-team"] },
          isPersonal: true,
          archivedAt: null,
        },
        data: { archivedAt: expect.any(Date) },
      });
      expect(tx.team.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["personal-team"] } },
        data: { archivedAt: expect.any(Date) },
      });
    });
  });

  describe("when the proof runs", () => {
    it("proves against the grants projection after offboarding", async () => {
      const { repository } = buildRepository({
        bindingIds: [],
        grantIds: [],
      });
      const seen: AuthzReadRepository[] = [];

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async (reader) => {
          seen.push(reader);
        },
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(GrantsAuthzReadRepository);
    });
  });

  describe("when every other administrator is already deactivated", () => {
    /** @scenario "An administrator who is already deactivated does not count as a way in" */
    it("refuses removing the only administrator who can still sign in", async () => {
      const { repository, offboardMember, tx } = buildRepository({
        bindingIds: [],
        grantIds: ["admin-grant"],
        activeAdminIds: [OFFBOARD_USER_ID],
      });

      await expect(
        repository.offboardUser({
          userId: OFFBOARD_USER_ID,
          organizationId: OFFBOARD_ORG_ID,
          actor: ACTOR,
          prove: async () => undefined,
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(offboardMember).not.toHaveBeenCalled();
      expect(tx.organizationUser.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when grant rows keyed to the user survive the revocation", () => {
    it("fails the offboarding even though the membership-gated proof passes", async () => {
      const { repository } = buildRepository({
        bindingIds: [],
        grantIds: ["survivor-1"],
        survivingGrantRows: 1,
      });
      // The collector-shaped proof is VACUOUS here by construction: both
      // heads' user reads gate on the organization membership this very
      // transaction deleted, so it resolves nothing whether or not the
      // revocations landed. A prove stub that swears everything is fine is
      // exactly what the direct row assertion must not be fooled by.
      const prove = vi.fn(async () => undefined);

      const attempt = repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove,
      });

      await expect(attempt).rejects.toMatchObject({
        code: "offboard_incomplete",
      });
    });

    it("ignores surviving compatibility rows because Grant is authoritative", async () => {
      const { repository, offboardMember } = buildRepository({
        bindingIds: ["rb-stuck"],
        grantIds: [],
      });

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async () => undefined,
      });

      expect(offboardMember).toHaveBeenCalledWith(
        expect.objectContaining({ revokedGrantIds: [] }),
      );
    });

    it("scopes the direct assertion to the user's principal in this organization", async () => {
      const { repository, tx } = buildRepository({
        bindingIds: [],
        grantIds: [],
      });

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async () => undefined,
      });

      // `revokedAt: null` is the postcondition, not decoration: a revoke
      // MARKS its row, so without the fence this counts the very rows the
      // revocation just ended and every departing member who held a grant
      // fails their own offboarding.
      expect(tx.grant.count).toHaveBeenCalledWith({
        where: {
          organizationId: OFFBOARD_ORG_ID,
          principalType: "USER",
          principalId: OFFBOARD_USER_ID,
          revokedAt: null,
        },
      });
      // Organization lock, active-admin lock, and the member-row lock.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    });
  });
});

function readRepository(prisma: PrismaClient) {
  return new LedgerAuthzGrantsRepository(prisma, harness().writer);
}

describe("grant tenancy reads", () => {
  describe("findCustomRole", () => {
    it("reads the tenancy and the vocabulary in one query", async () => {
      const findFirst = vi
        .fn()
        .mockResolvedValue({ organizationId: "org-1", permissions: ["a:b"] });
      const prisma = {
        role: { findFirst },
      } as unknown as PrismaClient;

      const role = await readRepository(prisma).findCustomRole({
        customRoleId: "role-1",
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "role-1", deletedAt: null },
        select: { organizationId: true, permissions: true },
      });
      expect(role).toEqual({ organizationId: "org-1", permissions: ["a:b"] });
    });
  });

  describe("findTeamOrganization", () => {
    it("reads the owning organization for a team", async () => {
      const findUnique = vi.fn().mockResolvedValue({ organizationId: "org-1" });
      const prisma = { team: { findUnique } } as unknown as PrismaClient;

      const result = await readRepository(prisma).findTeamOrganization({
        teamId: "team-1",
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "team-1" },
        select: { organizationId: true },
      });
      expect(result).toEqual({ organizationId: "org-1" });
    });
  });

  describe("findProjectLineage", () => {
    describe("when the project has no team", () => {
      it("returns null rather than a half-filled lineage", async () => {
        const findUnique = vi.fn().mockResolvedValue({ team: null });
        const prisma = { project: { findUnique } } as unknown as PrismaClient;

        const result = await readRepository(prisma).findProjectLineage({
          projectId: "project-1",
        });

        expect(result).toBeNull();
      });
    });

    describe("when the project has a team", () => {
      it("reads the team and organization the project belongs to", async () => {
        const findUnique = vi.fn().mockResolvedValue({
          team: { id: "team-1", organizationId: "org-1" },
        });
        const prisma = { project: { findUnique } } as unknown as PrismaClient;

        const result = await readRepository(prisma).findProjectLineage({
          projectId: "project-1",
        });

        expect(result).toEqual({ teamId: "team-1", organizationId: "org-1" });
      });
    });
  });
});

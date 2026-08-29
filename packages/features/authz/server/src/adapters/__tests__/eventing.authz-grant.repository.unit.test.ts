/**
 * The ledger-backed write port keeps the two typed failures the port
 * documents (ADR-092 §13, `@throws` on `AuthzGrantsRepository`).
 *
 * The parent class raised them from its own Prisma calls; this one writes
 * through the ledger writer, whose legacy path, ledger path and synchronous
 * enforcement can each surface a duplicate or missing-row signal. Anything
 * that escapes as a raw Prisma error degrades to an unknown 500 at the
 * boundary, which silently breaks the REST contract's 409 and 404 — so every
 * mapping is asserted here, by `code`, because that is how callers match.
 *
 * Offboarding rides along: it is the one write whose correctness is a
 * POSTCONDITION rather than a shape, so what it enumerates and what it proves
 * against are the two things worth pinning.
 */
import type { LedgerActor } from "@langwatch/actor";
import { BindingMissingError, DuplicateBindingError } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import type { EventingAuthzLedgerAdapter } from "../eventing.authz-ledger.adapter";
import type { AuthzReadRepository } from "../../repositories/authz-read.repository";
import { EventingAuthzGrantRepository } from "../../repositories/eventing/eventing.authz-grant.repository";
import { RoutedAuthzReadRepository } from "../../repositories/routed/routed.authz-read.repository";

const ORG_ID = "org_ledger";
const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

function prismaError(code: string): Error {
  return Object.assign(new Error("conflict"), { code });
}

function harness(writerOverrides: Partial<EventingAuthzLedgerAdapter> = {}) {
  const db = {
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue({ id: "rb_1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const writer = {
    attachBindings: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
    changeBindingRole: vi.fn().mockResolvedValue(undefined),
    revokeBindings: vi.fn().mockResolvedValue(undefined),
    revokeBindingsWhere: vi.fn().mockResolvedValue(1),
    offboardMember: vi.fn().mockResolvedValue(undefined),
    ...writerOverrides,
  } as unknown as EventingAuthzLedgerAdapter;
  return {
    db,
    writer,
    repository: EventingAuthzGrantRepository.create({
      database: db as never,
      writer,
      selectHead: async () => true,
    }),
  };
}

const binding = {
  bindingId: "rb_1",
  organizationId: ORG_ID,
  scopeType: "TEAM" as const,
  scopeId: "team_support",
  role: "MEMBER" as const,
  customRoleId: null,
  principal: { userId: "user_sam" },
};

describe("given a create that collides with an identical binding", () => {
  describe("when the writer raises the port's own duplicate", () => {
    it("lets it through, so the caller keeps its 409", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(new DuplicateBindingError()),
      } as Partial<EventingAuthzLedgerAdapter>);

      await expect(
        repository.createBinding({ row: binding, actor: ACTOR }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });

  describe("when the collision escapes as a raw unique violation", () => {
    it("maps it onto the port's duplicate rather than an unknown 500", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(prismaError("P2002")),
      } as Partial<EventingAuthzLedgerAdapter>);

      await expect(
        repository.createBinding({ row: binding, actor: ACTOR }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });
});

describe("given a role change on a row that is gone", () => {
  describe("when the writer raises Prisma's missing-record error", () => {
    it("maps it onto the port's missing binding, so the caller keeps its 404", async () => {
      const { repository } = harness({
        changeBindingRole: vi.fn().mockRejectedValue(prismaError("P2025")),
      } as Partial<EventingAuthzLedgerAdapter>);

      await expect(
        repository.updateBindingRole({
          bindingId: "rb_1",
          organizationId: ORG_ID,
          role: "ADMIN",
          customRoleId: null,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "role_binding_not_found" });
    });
  });

  describe("when a sibling already holds the target role", () => {
    it("keeps the duplicate answer", async () => {
      const { repository } = harness({
        changeBindingRole: vi.fn().mockRejectedValue(new DuplicateBindingError()),
      } as Partial<EventingAuthzLedgerAdapter>);

      await expect(
        repository.updateBindingRole({
          bindingId: "rb_1",
          organizationId: ORG_ID,
          role: "ADMIN",
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
      db.roleBinding.findFirst.mockResolvedValueOnce(null);

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
      db.roleBinding.findFirst.mockResolvedValueOnce(null);

      await expect(
        repository.replaceBinding({
          deleteWhere: {
            organizationId: ORG_ID,
            scopeType: "TEAM",
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
      } as Partial<EventingAuthzLedgerAdapter>);

      await repository.replaceBinding({
        deleteWhere: {
          organizationId: ORG_ID,
          scopeType: "TEAM",
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
      } as Partial<EventingAuthzLedgerAdapter>);

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
  survivingBindingRows = 0,
}: {
  bindingIds: string[];
  grantIds: string[];
  /** Grant-head rows still present INSIDE the transaction - the shape of a
   *  revocation that never actually landed. */
  survivingGrantRows?: number;
  survivingBindingRows?: number;
}) {
  const tx = {
    groupMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    teamUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    organizationUser: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: "gone@example.com" }),
    },
    organizationInvite: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    grant: { count: vi.fn().mockResolvedValue(survivingGrantRows) },
    roleBinding: { count: vi.fn().mockResolvedValue(survivingBindingRows) },
  };
  const roleBindingFindMany = vi.fn().mockResolvedValue(bindingIds.map((id) => ({ id })));
  const grantFindMany = vi.fn().mockResolvedValue(grantIds.map((id) => ({ id })));
  const prisma = {
    roleBinding: { findMany: roleBindingFindMany },
    grant: { findMany: grantFindMany },
    $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
  } as never;
  const offboardMember = vi.fn().mockResolvedValue(undefined);
  const writer = { offboardMember } as unknown as EventingAuthzLedgerAdapter;
  return {
    repository: EventingAuthzGrantRepository.create({
      database: prisma,
      writer,
      selectHead: async () => true,
    }),
    offboardMember,
    grantFindMany,
    tx,
  };
}

describe("given a member being offboarded", () => {
  describe("when the user holds facts on both heads", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("revokes the union of compat rows and grant-head rows, once each", async () => {
      const { repository, offboardMember, grantFindMany } = buildRepository({
        bindingIds: ["shared-1", "compat-only-2"],
        // "shared-1" is the same fact seen through the other head; the
        // lite-member row exists ONLY as a grant, which is exactly the
        // class a compat-only enumeration used to leave resolving.
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
        },
        select: { id: true },
      });
      expect(offboardMember).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: OFFBOARD_ORG_ID,
          userId: OFFBOARD_USER_ID,
          revokedGrantIds: ["shared-1", "compat-only-2", "lite-member-3"],
        }),
      );
    });
  });

  describe("when the proof runs", () => {
    it("reads through the head the organization is served from", async () => {
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
      expect(seen[0]).toBeInstanceOf(RoutedAuthzReadRepository);
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

    it("fails on surviving compat rows the same way", async () => {
      const { repository } = buildRepository({
        bindingIds: ["rb-stuck"],
        grantIds: [],
        survivingBindingRows: 1,
      });

      await expect(
        repository.offboardUser({
          userId: OFFBOARD_USER_ID,
          organizationId: OFFBOARD_ORG_ID,
          actor: ACTOR,
          prove: async () => undefined,
        }),
      ).rejects.toMatchObject({ code: "offboard_incomplete" });
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
      expect(tx.roleBinding.count).toHaveBeenCalledWith({
        where: { organizationId: OFFBOARD_ORG_ID, userId: OFFBOARD_USER_ID },
      });
    });
  });
});

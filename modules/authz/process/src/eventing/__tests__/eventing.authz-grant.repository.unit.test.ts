/**
 * Ledger-backed writer preserves two typed failures across all write paths
 * (ADR-092 §13); assert each mapping by code for REST contract correctness.
 */
import type { LedgerActor } from "@langwatch/actor";
import { BindingMissingError, DuplicateBindingError } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import type { AuthzReadRepository } from "../../repositories/authz-read.repository.ts";
import { EventingAuthzGrantRepository } from "../../repositories/eventing/eventing.authz-grant.repository.ts";
import { EventingAuthzReadRepository } from "../../repositories/eventing/eventing.authz-read.repository.ts";
import type { EventingAuthzLedgerAdapter } from "../authz-grant.store.ts";

const ORG_ID = "org_ledger";
const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

function prismaError(code: string): Error {
  return Object.assign(new Error("conflict"), { code });
}

/** A live grant row as Postgres hands it back. */
function storedGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "rb_1",
    organizationId: ORG_ID,
    principalType: "USER",
    principalId: "user_sam",
    roleKey: "member",
    legacyRole: "MEMBER",
    source: "grants-service",
    scopeType: "TEAM",
    scopeId: "team_support",
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: new Date(0),
    ...overrides,
  };
}

function harness(writerOverrides: Partial<EventingAuthzLedgerAdapter> = {}) {
  const db = {
    roleBinding: {
      findFirst: vi.fn().mockRejectedValue(new Error("legacy runtime read")),
      findMany: vi.fn().mockRejectedValue(new Error("legacy runtime read")),
    },
    grant: {
      findFirst: vi.fn().mockResolvedValue(storedGrant()),
      findMany: vi.fn().mockResolvedValue([storedGrant()]),
    },
  };
  const writer = {
    attachBindings: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
    changeBindingRole: vi.fn().mockResolvedValue(undefined),
    revokeBindings: vi.fn().mockResolvedValue(undefined),
    revokeBindingsWhere: vi.fn().mockResolvedValue(1),
    offboardMember: vi.fn().mockResolvedValue(undefined),
    ...writerOverrides,
  };
  return {
    db,
    writer,
    repository: EventingAuthzGrantRepository.create({ database: db as never, writer }),
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
  describe("when the writer raises its own duplicate", () => {
    it("lets it through, so the caller keeps its 409", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(new DuplicateBindingError()),
      } as Partial<EventingAuthzLedgerAdapter>);

      await expect(repository.createBinding({ row: binding, actor: ACTOR })).rejects.toMatchObject({
        code: "role_binding_already_exists",
      });
    });
  });

  describe("when the collision escapes as a raw unique violation", () => {
    it("maps it onto the writer's duplicate rather than an unknown 500", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(prismaError("P2002")),
      } as Partial<EventingAuthzLedgerAdapter>);

      await expect(repository.createBinding({ row: binding, actor: ACTOR })).rejects.toMatchObject({
        code: "role_binding_already_exists",
      });
    });
  });
});

describe("given a grant id that is not a role binding", () => {
  it("does not expose a resource grant through the binding port", async () => {
    const { db, repository } = harness();
    db.grant.findFirst.mockResolvedValueOnce(
      storedGrant({
        id: "share_1",
        principalType: "ANYONE",
        principalId: null,
        roleKey: null,
        legacyRole: null,
        scopeType: "RESOURCE",
        scopeId: "trace_1",
        token: "token_1",
        permission: "traces:view",
        resourceKind: "TRACE",
        projectId: "project_1",
      }),
    );

    await expect(repository.findBinding({ bindingId: "share_1" })).resolves.toBe(null);
  });
});

describe("given a role change on a row that is gone", () => {
  describe("when the writer raises Prisma's missing-record error", () => {
    it("maps it onto the writer's missing binding, so the caller keeps its 404", async () => {
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
    it("answers the writer's missing binding rather than a silent no-op", async () => {
      const { db, repository } = harness();
      db.grant.findFirst.mockResolvedValueOnce(null);

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
    it("answers the writer's missing binding and never revokes or attaches anything", async () => {
      const { db, repository, writer } = harness();
      db.grant.findFirst.mockResolvedValueOnce(null);

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
     * Pre-read found row; lagging projection may answer 0 (advisory). Old code
     * derived "missing" after revoking; pre-read now prevents access loss.
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
  describe("when the writer raises an members error", () => {
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
  grantIds,
  survivingGrantRows = 0,
}: {
  grantIds: string[];
  /** Grant-head rows still present INSIDE the transaction - the shape of a
   *  revocation that never actually landed. */
  survivingGrantRows?: number;
}) {
  const tx = {
    roleBinding: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    groupMembership: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    teamUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    organizationUser: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: "gone@example.com" }),
    },
    organizationInvite: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    grant: {
      findMany: vi.fn().mockResolvedValue(grantIds.map((id) => ({ id }))),
      count: vi.fn().mockResolvedValue(survivingGrantRows),
    },
  };
  const prisma = {
    roleBinding: { findMany: vi.fn().mockRejectedValue(new Error("legacy runtime read")) },
    $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
  } as never;
  const offboardMember = vi.fn().mockResolvedValue(undefined);
  const writer = {
    attachBindings: vi.fn(),
    changeBindingRole: vi.fn(),
    revokeBindings: vi.fn(),
    revokeBindingsWhere: vi.fn(),
    offboardMember,
  };
  return {
    repository: EventingAuthzGrantRepository.create({ database: prisma, writer }),
    offboardMember,
    grantFindMany: tx.grant.findMany,
    tx,
  };
}

describe("given a member being offboarded", () => {
  describe("when the user holds live grants", () => {
    /** @scenario "Offboarding a user removes every grant, with proof" */
    it("revokes every live grant head, including grants without a compat row", async () => {
      const { repository, offboardMember, grantFindMany } = buildRepository({
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

    it("drops the departing user's compatibility rows inside the transaction", async () => {
      const { repository, tx } = buildRepository({ grantIds: [] });

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async () => undefined,
      });

      expect(tx.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: OFFBOARD_ORG_ID, userId: OFFBOARD_USER_ID },
      });
    });
  });

  describe("when the proof runs", () => {
    it("proves against the grants projection after offboarding", async () => {
      const { repository } = buildRepository({ grantIds: [] });
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
      expect(seen[0]).toBeInstanceOf(EventingAuthzReadRepository);
    });
  });

  describe("when grant rows keyed to the user survive the revocation", () => {
    it("fails the offboarding even though the membership-gated proof passes", async () => {
      const { repository } = buildRepository({
        grantIds: ["survivor-1"],
        survivingGrantRows: 1,
      });
      // The collector-shaped proof is VACUOUS here by construction: the
      // user reads gate on the organization membership this very
      // transaction deleted, so it resolves nothing whether or not the
      // revocations landed.
      const prove = vi.fn(async () => undefined);

      await expect(
        repository.offboardUser({
          userId: OFFBOARD_USER_ID,
          organizationId: OFFBOARD_ORG_ID,
          actor: ACTOR,
          prove,
        }),
      ).rejects.toMatchObject({ code: "offboard_incomplete" });
    });

    it("scopes the direct assertion to the user's principal in this organization", async () => {
      const { repository, tx } = buildRepository({ grantIds: [] });

      await repository.offboardUser({
        userId: OFFBOARD_USER_ID,
        organizationId: OFFBOARD_ORG_ID,
        actor: ACTOR,
        prove: async () => undefined,
      });

      // `revokedAt: null` is the postcondition, not decoration: a revoke
      // MARKS its row, so without the fence this counts the very rows the
      // revocation just ended.
      expect(tx.grant.count).toHaveBeenCalledWith({
        where: {
          organizationId: OFFBOARD_ORG_ID,
          principalType: "USER",
          principalId: OFFBOARD_USER_ID,
          revokedAt: null,
        },
      });
    });
  });
});

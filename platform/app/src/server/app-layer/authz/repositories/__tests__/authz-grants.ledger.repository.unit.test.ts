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
 */
import type { GrantWriteActor } from "@langwatch/authz-server";
import {
  BindingMissingError,
  DuplicateBindingError,
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

const ORG_ID = "org_ledger";
const ACTOR: GrantWriteActor = { type: "user", id: "user_admin" };

function prismaError(code: string): Error {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

function harness(writerOverrides: Partial<GrantsLedgerWriter> = {}) {
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
        repository.createBinding(binding, { actor: ACTOR }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });

  describe("when the collision escapes as a raw unique violation", () => {
    it("maps it onto the port's duplicate rather than an unknown 500", async () => {
      const { repository } = harness({
        attachBindings: vi.fn().mockRejectedValue(prismaError("P2002")),
      } as Partial<GrantsLedgerWriter>);

      await expect(
        repository.createBinding(binding, { actor: ACTOR }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
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
  describe("when the revocation matched nothing", () => {
    it("answers the port's missing binding and never attaches the narrower one", async () => {
      const { repository, writer } = harness({
        revokeBindingsWhere: vi.fn().mockResolvedValue(0),
      } as Partial<GrantsLedgerWriter>);

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
      expect(writer.attachBindings).not.toHaveBeenCalled();
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
        .createBinding(binding, { actor: ACTOR })
        .catch((raised: unknown) => raised);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DuplicateBindingError);
      expect(error).not.toBeInstanceOf(BindingMissingError);
      expect((error as { code?: string }).code).toBeUndefined();
    });
  });
});

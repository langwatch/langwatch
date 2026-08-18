/**
 * SCIM is a reconciler (ADR-092 decision 18): a directory push is declarative
 * state, so the handler emits the difference between what the provider says
 * and what the projection holds — never the push itself. The property that
 * matters is that re-pushing the same state emits nothing at all, because an
 * IdP re-pushes on every sync and after every failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import {
  type DesiredScimGrant,
  reconcileScimGrants,
} from "./scim-grants.reconciler";

const ORG_ID = "org_1";
const USER_ID = "user_1";

const findMany = vi.fn();
const attachBindings = vi.fn();
const revokeBindings = vi.fn();

const prisma = {
  roleBinding: { findMany },
} as unknown as PrismaClient;

const writer = {
  attachBindings,
  revokeBindings,
} as unknown as GrantsLedgerWriter;

const memberOfOrg: DesiredScimGrant = {
  principal: { userId: USER_ID },
  role: TeamUserRole.MEMBER,
  customRoleId: null,
  scopeType: RoleBindingScopeType.ORGANIZATION,
  scopeId: ORG_ID,
};

const storedMemberRow = {
  id: "rb_1",
  userId: USER_ID,
  groupId: null,
  apiKeyId: null,
  scopeType: RoleBindingScopeType.ORGANIZATION,
  scopeId: ORG_ID,
  role: TeamUserRole.MEMBER,
  customRoleId: null,
};

const reconcile = (
  desired: DesiredScimGrant[],
  where: Prisma.RoleBindingWhereInput = { userId: USER_ID },
) =>
  reconcileScimGrants({
    prisma,
    writer,
    organizationId: ORG_ID,
    where,
    desired,
    actor: { type: "system", id: "system:scim" },
    mintBindingId: () => "rb_new",
  });

beforeEach(() => {
  vi.clearAllMocks();
  attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
  revokeBindings.mockResolvedValue(undefined);
});

describe("reconcileScimGrants", () => {
  describe("when the directory asserts a grant the projection does not hold", () => {
    it("attaches only the missing one, as a scim fact", async () => {
      findMany.mockResolvedValue([]);

      const outcome = await reconcile([memberOfOrg]);

      expect(outcome).toEqual({ attached: 1, revoked: 0 });
      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "scim",
          onDuplicate: "skip",
          bindings: [expect.objectContaining({ bindingId: "rb_new" })],
        }),
      );
      expect(revokeBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the same push arrives again", () => {
    it("emits nothing at all", async () => {
      findMany.mockResolvedValue([storedMemberRow]);

      const outcome = await reconcile([memberOfOrg]);

      expect(outcome).toEqual({ attached: 0, revoked: 0 });
      expect(attachBindings).not.toHaveBeenCalled();
      expect(revokeBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the directory stops asserting a grant", () => {
    it("revokes it, which is what carries the instant deny", async () => {
      findMany.mockResolvedValue([storedMemberRow]);

      const outcome = await reconcile([]);

      expect(outcome).toEqual({ attached: 0, revoked: 1 });
      expect(revokeBindings).toHaveBeenCalledWith(
        expect.objectContaining({ bindingIds: ["rb_1"] }),
      );
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when a stored grant differs only by its role", () => {
    it("revokes the stale one and attaches the asserted one", async () => {
      findMany.mockResolvedValue([
        { ...storedMemberRow, role: TeamUserRole.VIEWER },
      ]);

      const outcome = await reconcile([memberOfOrg]);

      expect(outcome).toEqual({ attached: 1, revoked: 1 });
      expect(revokeBindings).toHaveBeenCalledBefore(attachBindings);
    });
  });

  describe("when the principal holds a custom-role grant at the same scope", () => {
    it("tells it apart from the built-in one by its role id", async () => {
      findMany.mockResolvedValue([
        { ...storedMemberRow, id: "rb_custom", customRoleId: "cr_1" },
      ]);

      const outcome = await reconcile([memberOfOrg]);

      expect(outcome).toEqual({ attached: 1, revoked: 1 });
      expect(revokeBindings).toHaveBeenCalledWith(
        expect.objectContaining({ bindingIds: ["rb_custom"] }),
      );
    });
  });

  /**
   * The slice a push is authoritative over is a caller-supplied Prisma filter,
   * so the only thing keeping a directory sync inside its own tenant is where
   * the organization lands in that object. It goes LAST, and both halves of
   * the reconcile — the read that decides what to revoke, and the revoke
   * itself — carry it.
   */
  describe("given a caller-supplied filter naming a different organization", () => {
    describe("when the projection is read", () => {
      it("re-states this organization last, so the filter cannot widen out of the tenant", async () => {
        findMany.mockResolvedValue([]);

        await reconcile([], { userId: USER_ID, organizationId: "org_other" });

        expect(findMany).toHaveBeenCalledTimes(1);
        expect(findMany.mock.calls[0]![0].where).toEqual({
          userId: USER_ID,
          organizationId: ORG_ID,
        });
      });
    });

    describe("when the diff revokes something", () => {
      it("revokes inside this organization, never the one the filter named", async () => {
        findMany.mockResolvedValue([storedMemberRow]);

        await reconcile([], { userId: USER_ID, organizationId: "org_other" });

        expect(revokeBindings).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: ORG_ID,
            bindingIds: ["rb_1"],
          }),
        );
      });
    });

    describe("when the diff attaches something", () => {
      it("attaches inside this organization too", async () => {
        findMany.mockResolvedValue([]);

        await reconcile([memberOfOrg], {
          userId: USER_ID,
          organizationId: "org_other",
        });

        expect(attachBindings).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: ORG_ID }),
        );
      });
    });
  });

  describe("when nothing is stored and nothing is asserted", () => {
    it("stays silent rather than emitting an empty command", async () => {
      findMany.mockResolvedValue([]);

      const outcome = await reconcile([]);

      expect(outcome).toEqual({ attached: 0, revoked: 0 });
      expect(attachBindings).not.toHaveBeenCalled();
      expect(revokeBindings).not.toHaveBeenCalled();
    });
  });
});

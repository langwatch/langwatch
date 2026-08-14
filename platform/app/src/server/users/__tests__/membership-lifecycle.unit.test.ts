// @vitest-environment node
// ADR-094 Decision 4 / issue #6976. The Gates table names these tests by
// hand: scoped close, last-membership, same-transaction rollback,
// reactivation.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import { createFakePrisma, type FakePrisma } from "./fake-prisma";

// An App carrying no Redis, so the session-revocation helper the global
// escalation reaches takes its Postgres-only path instead of dialling a real
// Redis from a unit test.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

const revokeForUser = vi.fn().mockResolvedValue(undefined);
vi.mock("@ee/governance/services/cliTokenRevocation.service", () => ({
  CliTokenRevocationService: {
    create: () => ({ revokeForUser: (args: unknown) => revokeForUser(args) }),
  },
}));

const { MembershipLifecycleService } = await import(
  "../membership-lifecycle.service"
);

const JANUARY = new Date("2026-01-01T00:00:00Z");
const OFFBOARDED_AT = new Date("2026-06-01T00:00:00Z");

const link = (overrides: Record<string, unknown>) => ({
  id: `link-${Math.random()}`,
  seq: 1n,
  organizationId: "org-a",
  provider: "databricks",
  providerConnectionId: "conn-a",
  externalKind: "numeric_id",
  externalId: "1001",
  userId: "alice",
  effectiveFrom: JANUARY,
  recordedAt: JANUARY,
  source: "manual",
  actorUserId: "admin-1",
  erasedAt: null,
  ...overrides,
});

const seedTwoOrgs = () =>
  createFakePrisma({
    users: [{ id: "alice", deactivatedAt: null }],
    organizationUsers: [
      { userId: "alice", organizationId: "org-a", disabledAt: null },
      { userId: "alice", organizationId: "org-b", disabledAt: null },
    ],
    ingestionSources: [
      { id: "conn-a", organizationId: "org-a" },
      { id: "conn-b", organizationId: "org-b" },
    ],
    providerIdentityLinks: [
      link({ organizationId: "org-a", providerConnectionId: "conn-a" }),
      link({
        organizationId: "org-b",
        providerConnectionId: "conn-b",
        externalId: "2002",
      }),
    ],
  });

const serviceFor = (prisma: FakePrisma) =>
  MembershipLifecycleService.create(prisma as unknown as PrismaClient);

const closingRows = (prisma: FakePrisma) =>
  prisma.providerIdentityLink.rows.filter(
    (row) => row.source === "offboarding",
  );

describe("MembershipLifecycleService", () => {
  beforeEach(() => {
    revokeForUser.mockClear();
  });

  describe("given a person who belongs to two organizations", () => {
    describe("when their membership of one organization is deactivated", () => {
      it("closes the links in that organization and leaves the other untouched", async () => {
        const prisma = seedTwoOrgs();

        const outcome = await serviceFor(prisma).onMembershipDeactivated({
          organizationId: "org-a",
          userId: "alice",
          now: OFFBOARDED_AT,
        });

        expect(outcome.closedLinks).toBe(1);
        const closing = closingRows(prisma);
        expect(closing).toHaveLength(1);
        expect(closing[0]).toMatchObject({
          organizationId: "org-a",
          externalId: "1001",
          userId: null,
          source: "offboarding",
          effectiveFrom: OFFBOARDED_AT,
        });
      });

      it("keeps the account active, so the other organization is unaffected", async () => {
        const prisma = seedTwoOrgs();

        const outcome = await serviceFor(prisma).onMembershipDeactivated({
          organizationId: "org-a",
          userId: "alice",
          now: OFFBOARDED_AT,
        });

        expect(outcome.globallyDeactivated).toBe(false);
        expect(prisma.user.rows[0]!.deactivatedAt).toBeNull();
        expect(revokeForUser).not.toHaveBeenCalled();
      });

      it("disables that membership only", async () => {
        const prisma = seedTwoOrgs();

        await serviceFor(prisma).onMembershipDeactivated({
          organizationId: "org-a",
          userId: "alice",
          now: OFFBOARDED_AT,
        });

        expect(prisma.organizationUser.rows).toEqual([
          expect.objectContaining({
            organizationId: "org-a",
            disabledAt: OFFBOARDED_AT,
          }),
          expect.objectContaining({
            organizationId: "org-b",
            disabledAt: null,
          }),
        ]);
      });
    });

    describe("when the second organization goes too", () => {
      it("deactivates the account and revokes everything, only then", async () => {
        const prisma = seedTwoOrgs();
        const service = serviceFor(prisma);

        await service.onMembershipDeactivated({
          organizationId: "org-a",
          userId: "alice",
          now: OFFBOARDED_AT,
        });
        expect(revokeForUser).not.toHaveBeenCalled();

        const outcome = await service.onMembershipDeactivated({
          organizationId: "org-b",
          userId: "alice",
          now: OFFBOARDED_AT,
        });

        expect(outcome.globallyDeactivated).toBe(true);
        expect(prisma.user.rows[0]!.deactivatedAt).toEqual(OFFBOARDED_AT);
        expect(revokeForUser).toHaveBeenCalledWith({ userId: "alice" });
        expect(closingRows(prisma)).toHaveLength(2);
      });
    });
  });

  describe("given the append fails after the membership has been written", () => {
    it("rolls the whole transaction back, leaving nothing half-committed", async () => {
      const prisma = seedTwoOrgs();
      const boom = new Error("connection lost mid-offboarding");
      vi.spyOn(prisma.providerIdentityLink, "create").mockRejectedValueOnce(
        boom,
      );

      await expect(
        serviceFor(prisma).onMembershipDeactivated({
          organizationId: "org-a",
          userId: "alice",
          now: OFFBOARDED_AT,
        }),
      ).rejects.toThrow(boom);

      // The membership write is inside the same transaction, so it is gone
      // too — the state an IdP retry re-drives from.
      expect(
        prisma.organizationUser.rows.find(
          (row) => row.organizationId === "org-a",
        )?.disabledAt,
      ).toBeNull();
      expect(closingRows(prisma)).toHaveLength(0);
      expect(prisma.user.rows[0]!.deactivatedAt).toBeNull();
    });
  });

  describe("given a login the person held and an admin has since reassigned", () => {
    it("leaves it alone — closing it would take the new owner's money away", async () => {
      const prisma = createFakePrisma({
        users: [{ id: "alice", deactivatedAt: null }],
        organizationUsers: [
          { userId: "alice", organizationId: "org-a", disabledAt: null },
          { userId: "alice", organizationId: "org-b", disabledAt: null },
        ],
        ingestionSources: [{ id: "conn-a", organizationId: "org-a" }],
        providerIdentityLinks: [
          link({ seq: 1n, userId: "alice", effectiveFrom: JANUARY }),
          link({
            seq: 2n,
            userId: "bob",
            effectiveFrom: new Date("2026-03-01T00:00:00Z"),
          }),
        ],
      });

      const outcome = await serviceFor(prisma).onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: OFFBOARDED_AT,
      });

      expect(outcome.closedLinks).toBe(0);
      expect(closingRows(prisma)).toHaveLength(0);
    });
  });

  describe("given the links have already been closed", () => {
    it("appends nothing on a repeat — the operation is idempotent", async () => {
      const prisma = seedTwoOrgs();
      const service = serviceFor(prisma);

      await service.onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: OFFBOARDED_AT,
      });
      const second = await service.onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: new Date("2026-07-01T00:00:00Z"),
      });

      expect(second.closedLinks).toBe(0);
      expect(closingRows(prisma)).toHaveLength(1);
    });

    it("keeps the original disable timestamp rather than sliding it forward", async () => {
      const prisma = seedTwoOrgs();
      const service = serviceFor(prisma);

      await service.onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: OFFBOARDED_AT,
      });
      await service.onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: new Date("2026-07-01T00:00:00Z"),
      });

      expect(
        prisma.organizationUser.rows.find(
          (row) => row.organizationId === "org-a",
        )?.disabledAt,
      ).toEqual(OFFBOARDED_AT);
    });
  });

  describe("when a directory sends a DELETE rather than active:false", () => {
    it("removes the membership and its role bindings in the same transaction as the closing rows", async () => {
      const prisma = seedTwoOrgs();

      const outcome = await serviceFor(prisma).onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        membershipChange: "remove",
        now: OFFBOARDED_AT,
      });

      expect(outcome.closedLinks).toBe(1);
      expect(
        prisma.organizationUser.rows.map((row) => row.organizationId),
      ).toEqual(["org-b"]);
    });
  });

  describe("when the person is re-provisioned after offboarding", () => {
    it("restores the membership and lifts the account flag", async () => {
      const prisma = seedTwoOrgs();
      const service = serviceFor(prisma);
      await service.onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: OFFBOARDED_AT,
      });
      await service.onMembershipDeactivated({
        organizationId: "org-b",
        userId: "alice",
        now: OFFBOARDED_AT,
      });

      await service.onMembershipReactivated({
        organizationId: "org-a",
        userId: "alice",
      });

      expect(
        prisma.organizationUser.rows.find(
          (row) => row.organizationId === "org-a",
        )?.disabledAt,
      ).toBeNull();
      expect(prisma.user.rows[0]!.deactivatedAt).toBeNull();
    });

    it("does not restore the links — an admin relinks", async () => {
      const prisma = seedTwoOrgs();
      const service = serviceFor(prisma);
      await service.onMembershipDeactivated({
        organizationId: "org-a",
        userId: "alice",
        now: OFFBOARDED_AT,
      });

      await service.onMembershipReactivated({
        organizationId: "org-a",
        userId: "alice",
      });

      expect(closingRows(prisma)).toHaveLength(1);
      expect(
        prisma.providerIdentityLink.rows.filter(
          (row) => row.source !== "offboarding",
        ),
      ).toHaveLength(2);
    });

    it("leaves the other organization's membership exactly as it was", async () => {
      const prisma = seedTwoOrgs();
      const service = serviceFor(prisma);
      await service.onMembershipDeactivated({
        organizationId: "org-b",
        userId: "alice",
        now: OFFBOARDED_AT,
      });

      await service.onMembershipReactivated({
        organizationId: "org-a",
        userId: "alice",
      });

      expect(
        prisma.organizationUser.rows.find(
          (row) => row.organizationId === "org-b",
        )?.disabledAt,
      ).toEqual(OFFBOARDED_AT);
    });
  });

  describe("when the whole account is deactivated rather than one membership", () => {
    it("closes the open links in every organization the person was active in", async () => {
      const prisma = seedTwoOrgs();

      const outcome = await serviceFor(prisma).onUserDeactivated({
        userId: "alice",
        actorUserId: "alice",
        now: OFFBOARDED_AT,
      });

      expect(outcome).toEqual({ closedLinks: 2, globallyDeactivated: true });
      expect(
        closingRows(prisma)
          .map((row) => row.organizationId)
          .sort(),
      ).toEqual(["org-a", "org-b"]);
      expect(
        closingRows(prisma).every((row) => row.actorUserId === "alice"),
      ).toBe(true);
      expect(revokeForUser).toHaveBeenCalledWith({ userId: "alice" });
    });

    it("does not re-run the revocations when the account was already off", async () => {
      const prisma = seedTwoOrgs();
      const service = serviceFor(prisma);
      await service.onUserDeactivated({ userId: "alice", now: OFFBOARDED_AT });
      revokeForUser.mockClear();

      const outcome = await service.onUserDeactivated({
        userId: "alice",
        now: new Date("2026-07-01T00:00:00Z"),
      });

      expect(outcome.globallyDeactivated).toBe(false);
      expect(revokeForUser).not.toHaveBeenCalled();
      expect(prisma.user.rows[0]!.deactivatedAt).toEqual(OFFBOARDED_AT);
    });
  });
});

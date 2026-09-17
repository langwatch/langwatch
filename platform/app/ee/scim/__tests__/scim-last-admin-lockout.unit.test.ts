// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A directory may not deactivate the last administrator who can still sign in.
 *
 * WHAT THIS PREVENTS, observed end to end on a live stack: a first full sync
 * reported "1 created and 4 deactivated", and one of the four was the
 * organization's only administrator — somebody invited by hand, so in nobody's
 * directory. Their live session died mid-navigation and their password was
 * then refused. Getting back in took a hand-written SCIM call, because there
 * is no screen in the product that makes one.
 *
 * Adoption itself is deliberate and is not what this refuses: a token DOES
 * reach a person no connection has claimed (`ScimDirectoryIdentityService`
 * says so, and it is how a directory takes over members that predate it).
 * What is refused is narrower, and is about the organization rather than the
 * person — the act that would leave nobody able to administer it, which is
 * the same act `setMemberDisabled` already refuses by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, User } from "~/generated/prisma/client";
import { ScimService } from "../scim.service";

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ({
    attachBindings: vi.fn(),
    revokeBindings: vi.fn(),
    revokeBindingsWhere: vi.fn(),
    offboardMember: vi.fn(),
    defineRole: vi.fn(),
    deleteRole: vi.fn(),
  }),
}));

const ORGANIZATION = "org-1";
const ADMIN = "user-admin";

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: ADMIN,
    name: "Ada Admin",
    email: "ada@acme.test",
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    userHashKey: null,
    tracesExplorerTourDismissedAt: null,
    ...overrides,
  } as User;
}

/** `remainingAdmins` is what the guard counts: other admins who can still sign in. */
function createMockPrisma({ remainingAdmins }: { remainingAdmins: number }) {
  const deactivate = vi.fn().mockResolvedValue(buildUser());
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(buildUser()),
      create: vi.fn().mockResolvedValue(buildUser()),
      update: deactivate,
    },
    organizationUser: {
      findUnique: vi.fn().mockResolvedValue({ userId: ADMIN, role: "ADMIN" }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(remainingAdmins),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
    scimExternalId: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    session: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi
      .fn()
      .mockImplementation((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaClient;
  return { prisma, deactivate };
}

function buildService(prisma: PrismaClient) {
  return ScimService.create({
    prisma,
    grants: {
      offboard: vi.fn().mockResolvedValue({
        removed: {},
        needsHumanDecision: { ownedApiKeys: [], personalTeams: [] },
      }),
    } as never,
    syncLifecycle: {
      userPushed: vi.fn().mockResolvedValue(undefined),
      applyFailed: vi.fn().mockResolvedValue(undefined),
    } as never,
  });
}

const deactivatingPush = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: "ada@acme.test",
  active: false,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given the organization's only administrator", () => {
  describe("when the directory pushes them as inactive", () => {
    /** @scenario "A directory cannot deactivate the last administrator who can still sign in" */
    it("refuses, and leaves them exactly as they were", async () => {
      const { prisma, deactivate } = createMockPrisma({ remainingAdmins: 0 });

      await expect(
        buildService(prisma).replaceUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          request: deactivatingPush,
          connectionId: "conn-okta",
        }),
      ).rejects.toMatchObject({ code: "cannot_disable_last_admin" });

      // THE ORDER IS THE POINT. A refusal that still wrote the flag would
      // report the directory's requested state as reached while locking the
      // organization out anyway. `replaceUser` does write the profile fields
      // on its way here, so the assertion is about the one field that closes
      // the door rather than about the call count.
      const deactivatingWrites = deactivate.mock.calls.filter(
        ([args]) =>
          (args as { data?: Record<string, unknown> })?.data?.deactivatedAt,
      );
      expect(deactivatingWrites).toEqual([]);
    });
  });
});

describe("given an organization with another administrator who can sign in", () => {
  describe("when the directory pushes one of them as inactive", () => {
    /** @scenario "A directory may deactivate an administrator while another can still get in" */
    it("lets the deprovision through", async () => {
      const { prisma } = createMockPrisma({ remainingAdmins: 1 });

      await expect(
        buildService(prisma).replaceUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          request: deactivatingPush,
          connectionId: "conn-okta",
        }),
      ).resolves.toBeDefined();
    });

    /** @scenario "An administrator who is already deactivated does not count as a way in" */
    it("counts only administrators who are not already deactivated", async () => {
      // A membership-only count would let one push deactivate two
      // administrators in turn, each passing because the other's `disabledAt`
      // had not been written yet.
      const { prisma } = createMockPrisma({ remainingAdmins: 1 });

      await buildService(prisma).replaceUser({
        id: ADMIN,
        organizationId: ORGANIZATION,
        request: deactivatingPush,
        connectionId: "conn-okta",
      });

      const counted = (
        prisma.organizationUser.count as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[0];
      expect(counted).toMatchObject({
        where: {
          organizationId: ORGANIZATION,
          disabledAt: null,
          user: { deactivatedAt: null },
        },
      });
    });
  });
});

describe("given somebody who is not an administrator", () => {
  it("is deactivated without the guard having an opinion", async () => {
    const { prisma } = createMockPrisma({ remainingAdmins: 0 });
    (
      prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ userId: ADMIN, role: "MEMBER" });

    await expect(
      buildService(prisma).replaceUser({
        id: ADMIN,
        organizationId: ORGANIZATION,
        request: deactivatingPush,
        connectionId: "conn-okta",
      }),
    ).resolves.toBeDefined();

    // It never even counted: an ordinary member closes nothing.
    expect(prisma.organizationUser.count).not.toHaveBeenCalled();
  });
});

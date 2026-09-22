import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient, User } from "~/generated/prisma/client";
import { CannotRemoveLastAdminError } from "~/server/app-layer/organizations/errors";

import { ScimService } from "../scim.service";
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
import { resourceStore } from "./scim-user-resource.fixture";

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SCIM_V2_GRANTS: "on" } };
});

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

function createMockPrisma() {
  const deactivate = vi.fn().mockResolvedValue(buildUser());
  const prisma = {
    scimUserResource: resourceStore(),
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(buildUser()),
      create: vi.fn().mockResolvedValue(buildUser()),
      update: deactivate,
    },
    organizationUser: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ userId: ADMIN, role: "ADMIN" }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
    ssoConnection: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; organizationId: string } }) =>
          where.id === "conn-okta" && where.organizationId === ORGANIZATION
            ? { replacesConnectionId: null, migrationPhase: null }
            : null,
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; organizationId: string };
        }) =>
          where.organizationId === ORGANIZATION
            ? where.id.in
                .filter((id) => id === "conn-entra")
                .map((id) => ({ id }))
            : [],
      ),
    },
    scimDirectoryUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
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

function buildService(prisma: PrismaClient, offboardError?: Error) {
  return ScimService.create({
    prisma,
    grants: {
      offboard: offboardError
        ? vi.fn().mockRejectedValue(offboardError)
        : vi.fn().mockResolvedValue({
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
      const { prisma, deactivate } = createMockPrisma();

      await expect(
        buildService(prisma, new CannotRemoveLastAdminError()).replaceUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          request: deactivatingPush,
          connectionId: "conn-okta",
        }),
      ).rejects.toMatchObject({ code: "cannot_disable_last_admin" });

      expect(deactivate).not.toHaveBeenCalled();
      expect(prisma.scimUserResource.upsert).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization with another administrator who can sign in", () => {
  describe("when the directory pushes one of them as inactive", () => {
    /** @scenario "A directory may deactivate an administrator while another can still get in" */
    it("lets the deprovision through", async () => {
      const { prisma } = createMockPrisma();

      await expect(
        buildService(prisma).replaceUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          request: deactivatingPush,
          connectionId: "conn-okta",
        }),
      ).resolves.toBeDefined();
    });
  });
});

describe("given somebody who is not an administrator", () => {
  it("is deactivated without the guard having an opinion", async () => {
    const { prisma } = createMockPrisma();
    (
      prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      userId: ADMIN,
      role: "MEMBER",
    });

    await expect(
      buildService(prisma).replaceUser({
        id: ADMIN,
        organizationId: ORGANIZATION,
        request: deactivatingPush,
        connectionId: "conn-okta",
      }),
    ).resolves.toBeDefined();
  });
});

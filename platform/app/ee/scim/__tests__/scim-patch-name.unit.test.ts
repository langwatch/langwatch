import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient, User } from "~/generated/prisma/client";

import { ScimService } from "../scim.service";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A PATCH that names one half of a name changes that half and nothing else.
 *
 * TWO FAULTS MET HERE, and both returned 200. The handler skipped any
 * operation whose `value` was not an object, so `{path: "name.familyName",
 * value: "Smith"}` — the exact shape Okta and Entra send — changed nothing and
 * the request log filed it "Accepted". And where a dotted key WAS read, the
 * name was rebuilt from the half supplied, so patching a surname threw the
 * forename away.
 *
 * Spec: specs/identity/scim-connection-sync.feature
 */
import { resourceStore } from "./scim-user-resource.fixture";

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
const PERSON = "user-ada";

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: PERSON,
    name: "Ada Lovelace",
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
  const update = vi.fn().mockResolvedValue(buildUser());
  const prisma = {
    scimUserResource: resourceStore(),
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(buildUser()),
      create: vi.fn().mockResolvedValue(buildUser()),
      update,
    },
    organizationUser: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ userId: PERSON, role: "MEMBER" }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(2),
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
  return { prisma, update };
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

/** The name this PATCH stored, or undefined if it stored no name at all. */
async function nameAfterPatch(operation: unknown): Promise<string | undefined> {
  const { prisma } = createMockPrisma();
  await buildService(prisma).updateUser({
    id: PERSON,
    organizationId: ORGANIZATION,
    patchRequest: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [operation],
    } as never,
    connectionId: "conn-okta",
  });
  const resource = await prisma.scimUserResource.findUnique({
    where: {
      organizationId_userId: { organizationId: ORGANIZATION, userId: PERSON },
    },
  });
  return resource?.name ?? void 0;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a person stored as 'Ada Lovelace'", () => {
  describe("when the directory patches the surname with a dotted path and a string", () => {
    /** @scenario "A directory patches one half of a name with a dotted path" */
    it("keeps the forename and changes only the surname", async () => {
      expect(
        await nameAfterPatch({
          op: "replace",
          path: "name.familyName",
          value: "Smith",
        }),
      ).toBe("Ada Smith");
    });
  });

  describe("when the directory patches the forename with a dotted path and a string", () => {
    /** @scenario "A directory patches one half of a name with a dotted path" */
    it("keeps the surname and changes only the forename", async () => {
      expect(
        await nameAfterPatch({
          op: "replace",
          path: "name.givenName",
          value: "Grace",
        }),
      ).toBe("Grace Lovelace");
    });
  });

  describe("when the directory patches the surname as a dotted key inside a value object", () => {
    /** @scenario "A directory patches one half of a name with a dotted path" */
    it("keeps the forename rather than rebuilding the name from the half it was given", async () => {
      expect(
        await nameAfterPatch({
          op: "replace",
          value: { "name.familyName": "Smith" },
        }),
      ).toBe("Ada Smith");
    });
  });

  describe("when the directory sends both halves in a nested name object", () => {
    /** @scenario "A directory replaces both halves of a name at once" */
    it("stores exactly what it was sent", async () => {
      expect(
        await nameAfterPatch({
          op: "replace",
          value: { name: { givenName: "Grace", familyName: "Hopper" } },
        }),
      ).toBe("Grace Hopper");
    });
  });

  describe("when the directory addresses the name attribute by path", () => {
    /** @scenario "A directory replaces both halves of a name at once" */
    it("reads the parts unwrapped, because the path already named them", async () => {
      // The third spelling RFC 7644 allows. Its value carries the parts
      // directly rather than under a `name` key, so the wrapped branch cannot
      // see them and this answered 200 with the record untouched.
      expect(
        await nameAfterPatch({
          op: "replace",
          path: "name",
          value: { givenName: "Grace", familyName: "Hopper" },
        }),
      ).toBe("Grace Hopper");
    });

    /** @scenario "A directory patches one half of a name with a dotted path" */
    it("merges when the path form carries only one half", async () => {
      expect(
        await nameAfterPatch({
          op: "replace",
          path: "name",
          value: { familyName: "Hopper" },
        }),
      ).toBe("Ada Hopper");
    });
  });

  describe("when the operation carries no name at all", () => {
    /** @scenario "A directory patches one half of a name with a dotted path" */
    it("preserves the existing directory name", async () => {
      expect(
        await nameAfterPatch({
          op: "replace",
          value: { userName: "ada.new@acme.test" },
        }),
      ).toBe("Ada Lovelace");
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment node
// ADR-094 Decision 7, issues #6973 and #6974: the directory's id for a person
// is the anchor a cost report will later propose matches from, so it has to be
// parsed, stored, echoed back and filtered on.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "~/generated/prisma/client";
import { ScimService } from "../scim.service";
import {
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
} from "../scim.types";

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

// Provisioning reconciles the membership grant through the grants ledger
// (ADR-092 decision 18), so the writer is the seam this test stubs out — the
// anchor is what is under test, not the grant.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  offboardMember: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

// vi.mock is hoisted above every top-level const, so the spy the logger mock
// closes over has to be hoisted with it.
const warn = vi.hoisted(() => vi.fn());
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "langwatch:scim"
        ? { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
        : actual.createLogger(name),
  };
});

const ENTRA_OBJECT_ID = "6f8a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071";

const buildUser = (overrides: Partial<User> = {}): User =>
  ({
    id: "user-1",
    name: "Alice Smith",
    email: "alice@acme.com",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    deactivatedAt: null,
    ...overrides,
  }) as User;

const createMockPrisma = () => {
  const organizationUser = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const mock = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    organizationUser,
    roleBinding: {
      // The reconciler reads the grants this push is authoritative over.
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    providerIdentityLink: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    session: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi
      .fn()
      .mockImplementation((opsOrCallback: unknown) =>
        typeof opsOrCallback === "function"
          ? (opsOrCallback as (tx: unknown) => Promise<unknown>)(mock)
          : Promise.all(opsOrCallback as unknown[]),
      ),
  };
  return mock;
};

describe("the SCIM directory anchor", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ScimService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = ScimService.create({
      prisma: prisma as unknown as Parameters<
        typeof ScimService.create
      >[0]["prisma"],
    });
  });

  describe("when a directory queries for one user", () => {
    const whereOf = () =>
      (
        prisma.organizationUser.findMany.mock.calls[0]![0] as {
          where: Record<string, unknown>;
        }
      ).where;

    it.each([
      ['userName eq "alice@acme.com"', "alice@acme.com"],
      // Entra's documented example sends the value unquoted.
      ["userName eq alice@acme.com", "alice@acme.com"],
      ["  userName   eq   alice@acme.com  ", "alice@acme.com"],
    ])("matches %s on the email", async (filter, expected) => {
      await service.listUsers({ organizationId: "org-1", filter });

      expect(whereOf().user).toEqual({
        email: { equals: expected, mode: "insensitive" },
      });
    });

    it.each([
      [`externalId eq "${ENTRA_OBJECT_ID}"`, ENTRA_OBJECT_ID],
      [`externalId eq ${ENTRA_OBJECT_ID}`, ENTRA_OBJECT_ID],
    ])("matches %s on the anchor column", async (filter, expected) => {
      await service.listUsers({ organizationId: "org-1", filter });

      expect(whereOf()).toMatchObject({ externalId: expected });
      expect(whereOf().user).toBeUndefined();
    });

    it.each([
      "displayName eq alice",
      'userName sw "alice"',
      "userName eq",
      'externalId eq ""',
      "nonsense",
    ])("ignores the unsupported filter %s", async (filter) => {
      await service.listUsers({ organizationId: "org-1", filter });

      expect(whereOf()).toEqual({ organizationId: "org-1" });
    });
  });

  describe("when a directory provisions a new user carrying an externalId", () => {
    beforeEach(() => {
      prisma.user.create.mockResolvedValue(buildUser());
      prisma.organizationUser.findUnique.mockResolvedValue({
        externalId: ENTRA_OBJECT_ID,
        disabledAt: null,
      });
    });

    const create = () =>
      service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: ENTRA_OBJECT_ID,
        },
      });

    it("stores the anchor on the membership, marked directory-owned", async () => {
      await create();

      expect(prisma.organizationUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          externalId: ENTRA_OBJECT_ID,
          scimSource: "scim",
        }),
      });
    });

    it("echoes it back, so the directory can confirm what it wrote", async () => {
      const result = await create();

      expect(result).toHaveProperty("externalId", ENTRA_OBJECT_ID);
    });

    it("creates no usage-attribution link — the anchor only proposes, an admin decides", async () => {
      await create();

      expect(prisma.providerIdentityLink.create).not.toHaveBeenCalled();
    });
  });

  describe("when the inbound externalId is not a GUID", () => {
    it("warns about Entra's mutable default mapping but still provisions", async () => {
      prisma.user.create.mockResolvedValue(buildUser());
      prisma.organizationUser.findUnique.mockResolvedValue({
        externalId: "alice.smith",
        disabledAt: null,
      });

      const result = await service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          // Okta's immutable id is not a GUID either and has to keep working.
          externalId: "alice.smith",
        },
      });

      expect(result).toHaveProperty("externalId", "alice.smith");
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays quiet for a GUID", async () => {
      prisma.user.create.mockResolvedValue(buildUser());

      await service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: ENTRA_OBJECT_ID,
        },
      });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when a directory replaces a user", () => {
    it("persists the anchor on the existing membership", async () => {
      prisma.organizationUser.findUnique.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        disabledAt: null,
        externalId: ENTRA_OBJECT_ID,
      });
      prisma.user.update.mockResolvedValue(buildUser());
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await service.replaceUser({
        id: "user-1",
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: ENTRA_OBJECT_ID,
        },
      });

      expect(prisma.organizationUser.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", organizationId: "org-1" },
        data: { externalId: ENTRA_OBJECT_ID, scimSource: "scim" },
      });
    });
  });

  describe("when a directory PATCHes only the externalId", () => {
    it("persists it from the schema-qualified path form", async () => {
      prisma.organizationUser.findUnique.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        disabledAt: null,
        externalId: ENTRA_OBJECT_ID,
      });
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await service.updateUser({
        id: "user-1",
        organizationId: "org-1",
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            { op: "replace", path: "externalId", value: ENTRA_OBJECT_ID },
          ],
        },
      });

      expect(prisma.organizationUser.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", organizationId: "org-1" },
        data: { externalId: ENTRA_OBJECT_ID, scimSource: "scim" },
      });
    });
  });

  describe("given a person whose membership of this organization is disabled", () => {
    it("reports them inactive here, even though the account is alive elsewhere", () => {
      const result = service.toScimUser(buildUser(), {
        externalId: ENTRA_OBJECT_ID,
        disabledAt: new Date("2026-06-01T00:00:00Z"),
      });

      expect(result.active).toBe(false);
    });
  });

  // Entra sends an explicit null when the mapped attribute is empty. Both
  // /Users routes safeParse and answer 400 on failure, so a schema that
  // rejects null does not degrade — it breaks provisioning outright for that
  // directory, on a payload the endpoint accepted before the field was
  // declared at all.
  describe("given a directory that sends an explicit null externalId", () => {
    it("is accepted by the user schema rather than rejected as a 400", () => {
      const parsed = scimCreateUserRequestSchema.safeParse({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "alice@acme.com",
        externalId: null,
      });

      expect(parsed.success).toBe(true);
    });

    it("is accepted by the group schema too", () => {
      const parsed = scimCreateGroupRequestSchema.safeParse({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "Engineering",
        externalId: null,
      });

      expect(parsed.success).toBe(true);
    });

    it("provisions the user, storing no anchor and no directory marker", async () => {
      prisma.user.create.mockResolvedValue(buildUser());

      const result = await service.createUser({
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: null,
        },
      });

      expect(result).not.toHaveProperty("status");
      const created = prisma.organizationUser.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(created.data).not.toHaveProperty("externalId");
      expect(created.data).not.toHaveProperty("scimSource");
      expect(warn).not.toHaveBeenCalled();
    });

    it("leaves a stored anchor alone on replace — null is absent, not 'clear it'", async () => {
      // The anchor has no history to recover from, so a sync that happened to
      // carry an empty attribute must not detach the person from it.
      prisma.organizationUser.findUnique.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        disabledAt: null,
        externalId: ENTRA_OBJECT_ID,
      });
      prisma.user.update.mockResolvedValue(buildUser());
      prisma.user.findUnique.mockResolvedValue(buildUser());

      const result = await service.replaceUser({
        id: "user-1",
        organizationId: "org-1",
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "alice@acme.com",
          externalId: null,
        },
      });

      expect(prisma.organizationUser.updateMany).not.toHaveBeenCalled();
      expect(result).toHaveProperty("externalId", ENTRA_OBJECT_ID);
    });
  });

  describe("given a member no directory manages", () => {
    it("omits externalId rather than sending null", () => {
      const result = service.toScimUser(buildUser(), {
        externalId: null,
        disabledAt: null,
      });

      expect(result).not.toHaveProperty("externalId");
    });
  });
});

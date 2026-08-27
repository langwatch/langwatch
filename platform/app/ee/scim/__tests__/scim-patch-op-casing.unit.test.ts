// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Microsoft Entra sends PATCH operations with a capitalized `op` value —
 * `"Replace"`, `"Add"`, `"Remove"` — the way Microsoft's own SCIM provisioning
 * tutorial documents them, even though RFC 7644 §3.5.2 defines the values in
 * lowercase. Our schema used to accept only the lowercase spelling, so every
 * Entra offboard (`active: false`) and every group-membership change was
 * rejected with a 400 before reaching a handler.
 *
 * These tests drive the real parse-then-apply path with the capitalized
 * payloads rather than asserting on the schema alone, because the service layer
 * below it also compares `operation.op` against lowercase literals: normalising
 * at only one of the two seams would still drop the operation on the floor.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { ScimService } from "../scim.service";
import { scimPatchRequestSchema } from "../scim.types";
import { ScimGroupService } from "../scim-group.service";

// An App carrying no Redis, so the revoke helper reachable from the SCIM
// deactivation paths takes its Postgres-only path instead of talking to a real
// Redis from a unit test.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function parsePatch(body: unknown) {
  const parsed = scimPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `SCIM PATCH rejected at the schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function createMockPrisma() {
  const mock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    organizationUser: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([{ userId: "user-1" }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    providerIdentityLink: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    roleBinding: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    session: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    group: {
      findFirst: vi.fn().mockResolvedValue({
        id: "group-1",
        name: "Engineering",
        organizationId: "org-1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "group-1",
        name: "Engineering",
        organizationId: "org-1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    groupMembership: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi
      .fn()
      .mockImplementation((ops: unknown[] | ((tx: unknown) => unknown)) =>
        typeof ops === "function" ? ops(mock) : Promise.all(ops),
      ),
  };
  return mock as unknown as PrismaClient & typeof mock;
}

describe("SCIM PATCH op casing", () => {
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe("given an identity provider sends a capitalized op value", () => {
    describe("when the request is parsed", () => {
      it("accepts it and normalizes the op to the RFC spelling", () => {
        const parsed = parsePatch({
          schemas: [PATCH_SCHEMA],
          Operations: [
            { op: "Replace", path: "active", value: false },
            { op: "Add", path: "members", value: [{ value: "user-1" }] },
            { op: "Remove", path: 'members[value eq "user-1"]' },
          ],
        });

        expect(parsed.Operations.map((operation) => operation.op)).toEqual([
          "replace",
          "add",
          "remove",
        ]);
      });
    });

    describe("when the operation deactivates a user", () => {
      it("deactivates the user", async () => {
        const user = {
          id: "user-1",
          name: "Alice Smith",
          email: "alice@acme.com",
          deactivatedAt: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          updatedAt: new Date("2024-01-02T00:00:00Z"),
        };
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ userId: "user-1", organizationId: "org-1" });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...user,
          deactivatedAt: new Date(),
        });
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...user,
          deactivatedAt: new Date(),
        });

        const result = await ScimService.create({ prisma }).updateUser({
          id: "user-1",
          organizationId: "org-1",
          patchRequest: parsePatch({
            schemas: [PATCH_SCHEMA],
            Operations: [{ op: "Replace", path: "active", value: false }],
          }),
        });

        // The membership goes first, and it is the LAST one, so the account
        // follows (ADR-094 Decision 4). `updateMany` guarded on
        // `deactivatedAt: null`, not `update`: a repeated deactivate must not
        // slide the timestamp forward.
        expect(prisma.organizationUser.updateMany).toHaveBeenCalledWith({
          where: {
            userId: "user-1",
            organizationId: "org-1",
            disabledAt: null,
          },
          data: { disabledAt: expect.any(Date) },
        });
        expect(prisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: "user-1", deactivatedAt: null },
          data: { deactivatedAt: expect.any(Date) },
        });
        expect(result).toHaveProperty("active", false);
      });
    });

    describe("when the operation adds a group member", () => {
      it("adds the member to the group", async () => {
        await ScimGroupService.create({ prisma }).updateGroup({
          scimResourceId: "group-1",
          organizationId: "org-1",
          patchRequest: parsePatch({
            schemas: [PATCH_SCHEMA],
            Operations: [
              { op: "Add", path: "members", value: [{ value: "user-1" }] },
            ],
          }),
        });

        expect(prisma.groupMembership.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: { userId: "user-1", groupId: "group-1" },
          }),
        );
      });
    });

    describe("when the operation removes a group member", () => {
      it("removes the member from the group", async () => {
        await ScimGroupService.create({ prisma }).updateGroup({
          scimResourceId: "group-1",
          organizationId: "org-1",
          patchRequest: parsePatch({
            schemas: [PATCH_SCHEMA],
            Operations: [{ op: "Remove", path: 'members[value eq "user-1"]' }],
          }),
        });

        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-1"] } },
        });
      });
    });

    describe("when the operation renames the group", () => {
      it("renames the group", async () => {
        await ScimGroupService.create({ prisma }).updateGroup({
          scimResourceId: "group-1",
          organizationId: "org-1",
          patchRequest: parsePatch({
            schemas: [PATCH_SCHEMA],
            Operations: [
              { op: "Replace", path: "displayName", value: "Platform" },
            ],
          }),
        });

        expect(prisma.group.update).toHaveBeenCalledWith({
          where: { id: "group-1" },
          data: { name: "Platform" },
        });
      });
    });
  });

  describe("given an identity provider sends the RFC lowercase op value", () => {
    describe("when the request is parsed", () => {
      it("still accepts it", () => {
        const parsed = parsePatch({
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "replace", value: { active: false } }],
        });

        expect(parsed.Operations[0]?.op).toBe("replace");
      });
    });
  });

  describe("given an op value that is not a SCIM operation", () => {
    describe("when the request is parsed", () => {
      it("is rejected", () => {
        expect(
          scimPatchRequestSchema.safeParse({
            schemas: [PATCH_SCHEMA],
            Operations: [{ op: "Delete", value: {} }],
          }).success,
        ).toBe(false);
      });
    });
  });
});

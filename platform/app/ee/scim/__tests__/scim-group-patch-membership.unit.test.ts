// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A SCIM group PATCH used to read the *absence* of a member list as an
 * instruction to have no members: any `replace` that was not a `displayName`
 * rename fell into the full-member-replace block, computed "every current
 * member" as the set to remove, and silently emptied the group. An identity
 * provider replacing an unrelated attribute — or renaming a group with the
 * no-path form Entra ID writes — revoked access for everyone in it, with a
 * 200 and a valid ScimGroup body to show for it.
 *
 * These tests drive the real `ScimGroupService` with only Prisma mocked, so
 * they observe the membership writes the service actually issues rather than
 * asserting on the shape of the branch that issues them. Absent and empty are
 * the two sides of the same rule and both are pinned here: an operation that
 * never mentions members must leave membership alone, and an explicit
 * `members: []` must still clear the group, because that is a legitimate
 * request the IdP is entitled to make.
 *
 * Every assertion here is on the writes, not on the response body: the Prisma
 * mock returns a fixed membership for every read, so the group returned by a
 * "clears the group" case still lists its old members. That is deliberate — the
 * write is the behaviour under test, and end-state verification belongs to a
 * test with a real database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { scimPatchRequestSchema } from "../scim.types";
import { ScimGroupService } from "../scim-group.service";

/**
 * The warn log is behaviour here, not decoration. Leaving membership alone is
 * the safe answer to a payload we cannot read, but it is a silent one, so the
 * log is the only thing that makes a misconfigured sync findable. That makes
 * two things worth pinning: that it fires when we genuinely understood nothing,
 * and that it stays quiet on a supported operation — a warning on every rename
 * trains people to ignore the one that matters.
 */
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function parsePatch(operations: unknown[]) {
  const parsed = scimPatchRequestSchema.safeParse({
    schemas: [PATCH_SCHEMA],
    Operations: operations,
  });
  if (!parsed.success) {
    throw new Error(
      `SCIM PATCH rejected at the schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

const GROUP = {
  id: "group-1",
  name: "Engineering",
  organizationId: "org-1",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
};

/** A group already holding `user-1` and `user-2`. */
function createMockPrisma() {
  const mock = {
    organizationUser: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { userId: "user-1" },
          { userId: "user-2" },
          { userId: "user-3" },
        ]),
    },
    group: {
      findFirst: vi.fn().mockResolvedValue(GROUP),
      findUniqueOrThrow: vi.fn().mockResolvedValue(GROUP),
      update: vi.fn().mockResolvedValue({}),
    },
    groupMembership: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([
        { userId: "user-1", user: { id: "user-1", email: null, name: null } },
        { userId: "user-2", user: { id: "user-2", email: null, name: null } },
      ]),
    },
  };
  return mock as unknown as Parameters<typeof ScimGroupService.create>[0] &
    typeof mock;
}

describe("SCIM group PATCH membership", () => {
  let prisma: ReturnType<typeof createMockPrisma>;

  const patchGroup = async (operations: unknown[]) =>
    ScimGroupService.create(prisma).updateGroup({
      externalScimId: "group-1",
      organizationId: "org-1",
      patchRequest: parsePatch(operations),
    });

  beforeEach(() => {
    prisma = createMockPrisma();
    warn.mockClear();
  });

  describe("given a replace operation that names no members", () => {
    // externalId stands in for any attribute PATCH does not handle. That it is
    // unhandled is a gap rather than a decision — see #7141 — so this asserts
    // only what the fix is about: an operation about something else must not
    // touch membership.
    describe("when it replaces an unrelated attribute", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([
          { op: "replace", path: "externalId", value: "abc-123" },
        ]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
        expect(prisma.groupMembership.upsert).not.toHaveBeenCalled();
      });

      it("says in the logs that it understood nothing", async () => {
        await patchGroup([
          { op: "replace", path: "externalId", value: "abc-123" },
        ]);

        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ groupId: "group-1" }),
          expect.stringContaining("matched no known attribute"),
        );
      });
    });

    describe("when it renames the group with no path", () => {
      it("renames it and leaves the membership untouched", async () => {
        await patchGroup([
          { op: "replace", value: { displayName: "Platform" } },
        ]);

        expect(prisma.group.update).toHaveBeenCalledWith({
          where: { id: "group-1" },
          data: { name: "Platform" },
        });
        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });

      // A rename that mentions no members is complete and supported. Warning on
      // it would fire on every ordinary Entra rename, which is most of them.
      it("does not warn, because it understood the operation", async () => {
        await patchGroup([
          { op: "replace", value: { displayName: "Platform" } },
        ]);

        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe("when it renames the group with a displayName path", () => {
      it("renames it and leaves the membership untouched", async () => {
        await patchGroup([
          { op: "replace", path: "displayName", value: "Platform" },
        ]);

        expect(prisma.group.update).toHaveBeenCalledWith({
          where: { id: "group-1" },
          data: { name: "Platform" },
        });
        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when it targets a filtered member path we do not understand", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([
          {
            op: "replace",
            path: 'members[value eq "user-1"].display',
            value: "Alice",
          },
        ]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });
    });

    // An array is an object, so a bare-array value is the one shape where
    // "does this carry a member list" could quietly answer yes: `"members" in
    // []` is false, and the operation is correctly read as naming nothing.
    describe("when its value is a bare array rather than an attribute object", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([{ op: "replace", value: [{ value: "user-1" }] }]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a replace operation whose member list is missing or malformed", () => {
    describe("when a members path carries no value at all", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([{ op: "replace", path: "members" }]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when a members path carries something that is not a list", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([{ op: "replace", path: "members", value: "user-1" }]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });

      // Distinct from the unrecognised-attribute warning: this payload did name
      // members, so it is an IdP sending a shape worth fixing, not an operation
      // that was simply about something else.
      it("says in the logs that the member list was the problem", async () => {
        await patchGroup([{ op: "replace", path: "members", value: "user-1" }]);

        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ groupId: "group-1", path: "members" }),
          expect.stringContaining("did not give a list"),
        );
      });
    });

    describe("when a no-path value object holds a members key that is not a list", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([{ op: "replace", value: { members: "user-1" } }]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a replace operation that names an empty member list", () => {
    describe("when the list is written out as null", () => {
      it("clears the group", async () => {
        await patchGroup([{ op: "replace", path: "members", value: null }]);

        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-1", "user-2"] } },
        });
      });
    });

    describe("when the list is under a members path", () => {
      it("clears the group", async () => {
        await patchGroup([{ op: "replace", path: "members", value: [] }]);

        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-1", "user-2"] } },
        });
      });
    });

    describe("when the list is inside a no-path value object", () => {
      it("clears the group", async () => {
        await patchGroup([{ op: "replace", value: { members: [] } }]);

        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-1", "user-2"] } },
        });
      });
    });
  });

  describe("given a replace operation that names a member list", () => {
    describe("when the list differs from the current membership", () => {
      it("adds the newcomers and removes the ones left out", async () => {
        await patchGroup([
          {
            op: "replace",
            path: "members",
            value: [{ value: "user-2" }, { value: "user-3" }],
          },
        ]);

        expect(prisma.groupMembership.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: { userId: "user-3", groupId: "group-1" },
          }),
        );
        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-1"] } },
        });
      });
    });

    describe("when an operation that names no members comes first", () => {
      it("still applies the member list from the later operation", async () => {
        await patchGroup([
          { op: "replace", path: "externalId", value: "abc-123" },
          {
            op: "replace",
            path: "members",
            value: [{ value: "user-2" }, { value: "user-3" }],
          },
        ]);

        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-1"] } },
        });
      });
    });

    describe("when the no-path value object also renames the group", () => {
      it("applies both the rename and the membership replacement", async () => {
        await patchGroup([
          {
            op: "replace",
            value: { displayName: "Platform", members: [{ value: "user-1" }] },
          },
        ]);

        expect(prisma.group.update).toHaveBeenCalledWith({
          where: { id: "group-1" },
          data: { name: "Platform" },
        });
        expect(prisma.groupMembership.deleteMany).toHaveBeenCalledWith({
          where: { groupId: "group-1", userId: { in: ["user-2"] } },
        });
      });
    });
  });

  describe("given an add operation that names no members", () => {
    describe("when it targets an unrelated attribute", () => {
      it("leaves the group's membership untouched", async () => {
        await patchGroup([{ op: "add", path: "externalId", value: "abc-123" }]);

        expect(prisma.groupMembership.deleteMany).not.toHaveBeenCalled();
        expect(prisma.groupMembership.upsert).not.toHaveBeenCalled();
      });
    });
  });
});

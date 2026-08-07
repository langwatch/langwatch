/**
 * The refusal rules of the guarded teardown, on a recording fake so each
 * case can assert the exact deletes that were (not) issued.
 *
 * Spec: specs/setup/test-teardown-safety.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { cleanupTestRows } from "../cleanupTestRows";

function recordingPrisma() {
  const calls: Array<{ model: string; where: unknown }> = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, model: string) {
      return {
        deleteMany: vi.fn(async (args: { where: unknown }) => {
          calls.push({ model, where: args.where });
          return { count: 0 };
        }),
      };
    },
  };
  return {
    prisma: new Proxy({}, handler) as unknown as PrismaClient,
    calls,
  };
}

describe("cleanupTestRows refusal rules", () => {
  describe("given an id that was never assigned", () => {
    /** @scenario "An id that was never assigned" */
    it("deletes nothing for that entry and names the model and field", async () => {
      const { prisma, calls } = recordingPrisma();
      let teamId!: string;

      await expect(
        cleanupTestRows(prisma, [["team", { id: teamId }]]),
      ).rejects.toThrow(/team\[0\]\.where\.id is undefined/);

      expect(calls).toEqual([]);
    });

    it("nested undefined collapses the same way and is refused the same way", async () => {
      const { prisma, calls } = recordingPrisma();
      let organizationId!: string;

      await expect(
        cleanupTestRows(prisma, [
          ["team", { organizationId: { in: organizationId } as never }],
        ]),
      ).rejects.toThrow(/team\[0\]\.where\.organizationId\.in is undefined/);

      expect(calls).toEqual([]);
    });
  });

  describe("given an empty id or empty list", () => {
    /** @scenario "An empty id or empty list is refused" */
    it("refuses an empty string", async () => {
      const { prisma, calls } = recordingPrisma();

      await expect(
        cleanupTestRows(prisma, [["organization", { id: "" }]]),
      ).rejects.toThrow(/organization\[0\]\.where\.id is an empty string/);

      expect(calls).toEqual([]);
    });

    /** @scenario "A list that arrived empty cleans nothing without failing" */
    it("treats a list that arrived empty as a match-none no-op", async () => {
      // The accumulator pattern: `let ids: string[] = []`, filled as tests
      // create rows, legitimately empty when they created none. Prisma's
      // `in: []` matched nothing, and so does the skip.
      const { prisma, calls } = recordingPrisma();

      await expect(
        cleanupTestRows(prisma, [["organization", { id: { in: [] } }]]),
      ).resolves.toBeUndefined();

      expect(calls).toEqual([]);
    });

    /** @scenario "An empty id or empty list is refused" */
    it("refuses a list that lost every member to unassigned ids", async () => {
      const { prisma, calls } = recordingPrisma();
      let orgId!: string;

      await expect(
        cleanupTestRows(prisma, [["organization", { id: { in: [orgId] } }]]),
      ).rejects.toThrow(/lost every member/);

      expect(calls).toEqual([]);
    });

    it("refuses an empty where outright", async () => {
      const { prisma, calls } = recordingPrisma();

      await expect(
        cleanupTestRows(prisma, [["organization", {}]]),
      ).rejects.toThrow(/organization\[0\]\.where must be a non-empty object/);

      expect(calls).toEqual([]);
    });

    it("refuses an empty nested filter, which matches every row", async () => {
      const { prisma, calls } = recordingPrisma();

      await expect(
        cleanupTestRows(prisma, [["organization", { id: {} }]]),
      ).rejects.toThrow(/organization\[0\]\.where\.id is an empty object/);

      expect(calls).toEqual([]);
    });
  });

  describe("given an unassigned id nested inside an OR branch", () => {
    it("refuses it: object members of arrays recurse like everything else", async () => {
      const { prisma, calls } = recordingPrisma();
      let scopeId!: string;

      await expect(
        cleanupTestRows(prisma, [
          [
            "modelProvider",
            {
              OR: [
                { organizationId: "org_a" },
                { scopes: { some: { scopeId } } },
              ],
            },
          ],
        ]),
      ).rejects.toThrow(
        /modelProvider\[0\]\.where\.OR\[1\]\.scopes\.some\.scopeId is undefined/,
      );

      expect(calls).toEqual([]);
    });
  });

  describe("given a list with an unassigned member among real ids", () => {
    it("narrows to the real ids, deletes those, and still ends loud", async () => {
      const { prisma, calls } = recordingPrisma();
      let otherOrgId!: string;

      await expect(
        cleanupTestRows(prisma, [
          ["modelProvider", { organizationId: { in: ["org_a", otherOrgId] } }],
        ]),
      ).rejects.toThrow(/organizationId\.in\[1\] was undefined; dropped/);

      expect(calls).toEqual([
        {
          model: "modelProvider",
          where: { organizationId: { in: ["org_a"] } },
        },
      ]);
    });
  });

  describe("given intentional null filters", () => {
    it("passes them through: Prisma keeps null in the filter", async () => {
      const { prisma, calls } = recordingPrisma();

      await cleanupTestRows(prisma, [
        ["project", { teamId: "team_a", archivedAt: null }],
      ]);

      expect(calls).toEqual([
        { model: "project", where: { teamId: "team_a", archivedAt: null } },
      ]);
    });
  });

  describe("given a model that resolves to something without deleteMany", () => {
    it("reports it as not a Prisma delegate, instead of crashing", async () => {
      const prisma = { organization: {} } as unknown as PrismaClient;

      await expect(
        cleanupTestRows(prisma, [["organization", { id: "org_a" }]]),
      ).rejects.toThrow(
        /organization is not a Prisma delegate with deleteMany/,
      );
    });
  });
});

/** @vitest-environment node */

/**
 * Deleting a group MARKS it, so the marked membership rows it holds are not
 * cascaded away with it — the record of who was in it and when they left is
 * the whole reason a removal marks rather than deletes.
 *
 * That makes a deleted group a readable row, and a read that forgets
 * `deletedAt: null` gets one back and treats it as a group that still exists:
 * it lists, it can be edited, and every RoleBinding hanging off it resolves.
 * The mistake fails OPEN and is invisible in a diff, exactly like the one
 * `liveGrants` exists to prevent.
 *
 * `liveGroups` / `LIVE_GROUP` make it unwriteable. This checks the fence
 * itself, and then the one thing that could undo it: someone reaching past it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_GROUP, liveGroups } from "../live-rows";

const APP_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..", "..");

/**
 * Every source file that reads the Group table, and what it is allowed to do.
 * Kept as a list rather than a directory walk so a new reader has to be added
 * here deliberately — which is the moment somebody asks whether it wants live
 * groups or history.
 */
const GROUP_READING_SOURCES = [
  "server/app-layer/groups/repositories/group.prisma.repository.ts",
  "server/app-layer/authz/repositories/access-listing.grants.repository.ts",
  "server/api/routers/group.ts",
  "server/api/utils.ts",
  "server/role-bindings/role-binding.service.ts",
  "server/gateway/budget.service.ts",
  "server/gateway/scopeTargets.ts",
  "server/api/routers/gatewayBudgets.ts",
  "server/data-privacy/dataPrivacyPolicy.read.ts",
  "app/api/gateway-platform/[[...route]]/app.ts",
];

/**
 * The one read that deliberately looks past the fence, and why: `delete` has
 * to tell "no such group" apart from "already deleted" so it can answer with
 * the right refusal instead of contradicting a record the caller can read.
 */
const DELIBERATE_HISTORY_READS = [
  "server/app-layer/groups/repositories/group.prisma.repository.ts:findIncludingDeleted",
];

const DIRECT_READ =
  /prisma\.group\.(findMany|findFirst|findUnique|findUniqueOrThrow|count)\(/g;

describe("group reads", () => {
  describe("given the fence lives in the accessor", () => {
    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("applies it to a group query that names no where clause at all", async () => {
      const calls: unknown[] = [];
      const prisma = {
        group: { findMany: async (args: unknown) => (calls.push(args), []) },
      };

      await liveGroups(prisma as never).findMany({});

      expect(calls[0]).toEqual({ where: { deletedAt: null } });
    });

    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("applies it alongside the caller's own clause", async () => {
      const calls: unknown[] = [];
      const prisma = {
        group: { findFirst: async (args: unknown) => (calls.push(args), null) },
      };

      await liveGroups(prisma as never).findFirst({
        where: { organizationId: "org_1", slug: "sec-eng" },
      });

      expect(calls[0]).toEqual({
        where: { organizationId: "org_1", slug: "sec-eng", deletedAt: null },
      });
    });

    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("wins over a caller that tried to state deletedAt itself", async () => {
      const calls: unknown[] = [];
      const prisma = {
        group: { count: async (args: unknown) => (calls.push(args), 0) },
      };

      await liveGroups(prisma as never).count({
        where: { organizationId: "org_1", deletedAt: { not: null } },
      });

      expect(calls[0]).toEqual({
        where: { organizationId: "org_1", deletedAt: null },
      });
    });

    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("fences a lookup by id, which is where a deleted group would slip through", async () => {
      const calls: unknown[] = [];
      const prisma = {
        group: {
          findUnique: async (args: unknown) => (calls.push(args), null),
        },
      };

      await liveGroups(prisma as never).findUnique({ where: { id: "grp_1" } });

      expect(calls[0]).toEqual({ where: { id: "grp_1", deletedAt: null } });
    });

    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("says the same thing as the relation filter", () => {
      expect(LIVE_GROUP).toEqual({ deletedAt: null });
    });
  });

  describe("given a reader could reach past the accessor", () => {
    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("finds no unfenced group read outside the one that wants history", () => {
      const direct = GROUP_READING_SOURCES.flatMap((file) => {
        const source = readFileSync(path.join(APP_ROOT, file), "utf8");
        return [...source.matchAll(DIRECT_READ)].map((match) => {
          const before = source.slice(0, match.index);
          const line = before.split("\n").length;
          // The nearest method declaration above the read. A read inside
          // `findIncludingDeleted` is the deliberate one; anywhere else is a
          // forgotten fence, and the message says where.
          const enclosing = [...before.matchAll(/async (\w+)\(/g)].at(-1)?.[1];
          return { where: `${file}:${line}`, enclosing };
        });
      });

      const forgotten = direct
        .filter(
          (read) =>
            !DELIBERATE_HISTORY_READS.includes(
              `${read.where.split(":")[0]}:${read.enclosing}`,
            ),
        )
        .map((read) => `${read.where} reads a group without the fence`)
        .sort();

      expect(forgotten).toEqual([]);
    });

    /** @scenario "The first deletion is the one that counts" */
    it("keeps that one read, because delete has two refusals to tell apart", () => {
      const [entry] = DELIBERATE_HISTORY_READS;
      const [file, method] = entry!.split(":");
      const source = readFileSync(path.join(APP_ROOT, file!), "utf8");

      expect(source).toContain(`async ${method}(`);
      expect([...source.matchAll(DIRECT_READ)].length).toBe(1);
    });
  });
});

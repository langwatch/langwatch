/** @vitest-environment node */

/**
 * A revoke marks its row rather than deleting it, so a read that forgets to
 * exclude the marked ones authorizes revoked access — a mistake that fails
 * OPEN and is invisible in a diff.
 *
 * `liveGrants` / `liveRoles` make it unwriteable: they are the only way these
 * repositories reach the tables, and the fence is inside them. This checks
 * the one thing that could undo that — someone reaching past them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { liveGrants, liveRoles } from "../live-rows";

const REPOSITORIES = path.join(import.meta.dirname, "..");

/** The repositories whose reads answer, or list, live access. Deliberately
 *  excludes the migration repository: its job is to inventory what an
 *  organization has held, ended or not. */
const ACCESS_READING_SOURCES = [
  "authz-read.grants.repository.ts",
  "access-listing.grants.repository.ts",
];

const DIRECT_READ = /prisma\.(grant|role)\.(findMany|findFirst)\(/g;

describe("authorization reads", () => {
  describe("given the fence lives in the accessor", () => {
    /** @scenario "A revoked grant authorizes nothing" */
    it("applies it to a grant query that names no where clause at all", async () => {
      const calls: unknown[] = [];
      const prisma = {
        grant: { findMany: async (args: unknown) => (calls.push(args), []) },
      };

      await liveGrants(prisma as never).findMany({});

      expect(calls[0]).toEqual({ where: { revokedAt: null } });
    });

    /** @scenario "A deleted role grants nothing" */
    it("applies it to a role query alongside the caller's own clause", async () => {
      const calls: unknown[] = [];
      const prisma = {
        role: { findFirst: async (args: unknown) => (calls.push(args), null) },
      };

      await liveRoles(prisma as never).findFirst({
        where: { organizationId: "org_1" },
      });

      expect(calls[0]).toEqual({
        where: { organizationId: "org_1", deletedAt: null },
      });
    });
  });

  describe("given a repository could reach past the accessor", () => {
    /** @scenario "Every access-deciding read goes through the fence" */
    it("finds no direct table read in the repositories that decide access", () => {
      const direct = ACCESS_READING_SOURCES.flatMap((file) => {
        const source = readFileSync(path.join(REPOSITORIES, file), "utf8");
        return [...source.matchAll(DIRECT_READ)]
          .filter((match) => !match[0].startsWith("liveGrants"))
          .map((match) => {
            const line = source.slice(0, match.index).split("\n").length;
            return `${file}:${line} reads ${match[1]} without the fence`;
          });
      }).sort();

      expect(direct).toEqual([]);
    });
  });
});

/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/server/db";

const migrationFile = join(
  process.cwd(),
  "prisma/migrations/20260907120007_identity_auth/migration.sql",
);

function impersonationRevokeStatement(): string {
  const sql = readFileSync(migrationFile, "utf8");
  const matched = sql.match(
    /DELETE FROM "Session" WHERE "impersonating" IS NOT NULL;/,
  );
  if (!matched) {
    throw new Error("identity auth migration lost its impersonation revoke");
  }
  return matched[0];
}

describe("identity auth migration impersonation revoke", () => {
  /** @scenario "The one revoke at deploy is the impersonating sessions" */
  it("replays the shipped predicate and preserves an ordinary legacy session", async () => {
    const suffix = nanoid(8);
    const userId = `migration-user-${suffix}`;
    const impersonatingId = `migration-impersonating-${suffix}`;
    const ordinaryId = `migration-ordinary-${suffix}`;
    const rollback = new Error("rollback migration replay fixture");

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            name: "Migration Replay",
            email: `${userId}@example.com`,
          },
        });
        await tx.session.createMany({
          data: [
            {
              id: impersonatingId,
              sessionToken: `token-${impersonatingId}`,
              userId,
              expires: new Date("2099-01-01T00:00:00.000Z"),
              impersonating: { operatorId: "operator-old" },
            },
            {
              id: ordinaryId,
              sessionToken: `token-${ordinaryId}`,
              userId,
              expires: new Date("2099-01-01T00:00:00.000Z"),
              impersonating: Prisma.DbNull,
            },
          ],
        });

        const shipped = impersonationRevokeStatement().replace(/;$/, "");
        await tx.$executeRawUnsafe(
          `-- @tenancy: replaying the shipped fleet-wide impersonation revoke, narrowed to this test's synthetic sessions
${shipped} AND "id" IN ($1, $2)`,
          impersonatingId,
          ordinaryId,
        );

        const survivors = await tx.session.findMany({
          where: { id: { in: [impersonatingId, ordinaryId] } },
          select: { id: true, impersonating: true },
        });
        expect(survivors).toEqual([{ id: ordinaryId, impersonating: null }]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});

import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  IDENTITY_BORN_REPORT_KIND,
  PrismaIdentityNewbornRepository,
} from "../prisma.identity-newborn.repository.ts";

/**
 * same `migrated` status under the same migration name as an abandoned newborn — only the
 * `report.kind` tells them apart — so the exclusion has to be part of the WHERE clause,
 * `findAbandoned`'s candidate query (ADR-116 §3). A held user carries the
 */

interface Claim {
  tenantId: string;
  status: string;
  updatedAt: Date;
  report: { kind: string };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function makeFakePrisma(claims: Claim[], users: string[]) {
  return prismaDouble({
    systemMigrationTenantState: {
      findMany: async (args: unknown) => {
        const where = field(args, "where");
        const before = field(field(where, "updatedAt"), "lt");
        const take = field(args, "take");
        const ascending = field(field(args, "orderBy"), "updatedAt") === "asc";
        if (!(before instanceof Date) || typeof take !== "number") throw new Error("bad query");
        return claims
          .filter(
            (c) =>
              c.status === field(where, "status") &&
              c.updatedAt < before &&
              c.report.kind === field(field(where, "report"), "equals"),
          )
          .toSorted((a, b) =>
            ascending
              ? a.updatedAt.getTime() - b.updatedAt.getTime()
              : b.updatedAt.getTime() - a.updatedAt.getTime(),
          )
          .slice(0, take)
          .map((c) => ({ tenantId: c.tenantId, updatedAt: c.updatedAt }));
      },
    },
    user: {
      findMany: async (args: unknown) => {
        const ids = field(field(field(args, "where"), "id"), "in");
        return (Array.isArray(ids) ? ids : [])
          .filter((id) => users.includes(id))
          .map((id) => ({ id }));
      },
    },
  });
}

describe("PrismaIdentityNewbornRepository.findAbandoned", () => {
  describe("given more held users than one sweep page holds carry the same migrated status", () => {
    describe("when the sweep asks for a single candidate", () => {
      /** @scenario "The sweep finds an orphan behind a page of held users" */
      it("returns the abandoned newborn, never a held user", async () => {
        const oldest = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const horizon = nowInstant().subtract({ milliseconds: 60 * 60 * 1000 });

        const held: Claim[] = ["held-a", "held-b", "held-c"].map((id) => ({
          tenantId: id,
          status: "migrated",
          updatedAt: oldest,
          report: { kind: "identifier_backfill" },
        }));
        const orphan: Claim = {
          tenantId: "orphan",
          status: "migrated",
          updatedAt: old,
          report: { kind: IDENTITY_BORN_REPORT_KIND },
        };
        // Held claims are OLDER, so they sort ahead of the orphan — a page as
        // wide as they are cannot reach it unless the query excludes them.
        const prisma = makeFakePrisma([...held, orphan], []);
        const repository = new PrismaIdentityNewbornRepository(prisma);

        const found = await repository.findAbandoned({ olderThan: horizon, limit: 1 });

        expect(found.map((row) => row.userId)).toEqual(["orphan"]);
      });
    });
  });
});

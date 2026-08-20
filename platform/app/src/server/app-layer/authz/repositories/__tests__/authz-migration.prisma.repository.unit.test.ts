import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaAuthzMigrationRepository } from "../authz-migration.prisma.repository";

/**
 * The platform-admin lookup, which is the one migration read whose result
 * becomes a durable PLATFORM-scope grant: whoever comes back from it is
 * stated as an operator of the whole installation. Prisma's Postgres compiler
 * renders a case-insensitive `equals` as ILIKE with no ESCAPE, so the address
 * reaches the database as a PATTERN — which is why the match itself is
 * decided in application code, over the whole address.
 */
describe("PrismaAuthzMigrationRepository", () => {
  describe("findUsersByEmail", () => {
    describe("when the database returns an account the pattern dragged in", () => {
      it("rejects an address matching only where the underscore is", async () => {
        // ILIKE reads `_` as "any single character", so this row is exactly
        // what Postgres hands back for `first_last@corp.com`.
        const findMany = vi.fn().mockResolvedValue([
          {
            id: "user_near_miss",
            email: "firstXlast@corp.com",
            createdAt: new Date(1_700_000_000_000),
          },
          {
            id: "user_operator",
            email: "First_Last@corp.com",
            createdAt: new Date(1_700_000_000_001),
          },
        ]);
        const prisma = { user: { findMany } } as unknown as PrismaClient;

        const admins = await new PrismaAuthzMigrationRepository(
          prisma,
        ).findUsersByEmail({ emails: ["first_last@corp.com"] });

        expect(admins).toEqual([
          {
            userId: "user_operator",
            email: "first_last@corp.com",
            createdAtMs: 1_700_000_000_001,
          },
        ]);
      });

      /** @scenario "A platform admin address is matched in full, never as a pattern" */
      it("returns nothing at all when only the near miss came back", async () => {
        const findMany = vi.fn().mockResolvedValue([
          {
            id: "user_near_miss",
            email: "firstXlast@corp.com",
            createdAt: new Date(1_700_000_000_000),
          },
        ]);
        const prisma = { user: { findMany } } as unknown as PrismaClient;

        // Nothing comes back, so the caller reports the address as having no
        // account behind it — a near miss must not read as a match and
        // silence that warning.
        expect(
          await new PrismaAuthzMigrationRepository(prisma).findUsersByEmail({
            emails: ["first_last@corp.com"],
          }),
        ).toEqual([]);
      });

      it("rejects every account when the list carries a bare wildcard", async () => {
        const findMany = vi.fn().mockResolvedValue([
          {
            id: "user_alice",
            email: "alice@corp.com",
            createdAt: new Date(1_700_000_000_000),
          },
          {
            id: "user_bob",
            email: "bob@corp.com",
            createdAt: new Date(1_700_000_000_001),
          },
        ]);
        const prisma = { user: { findMany } } as unknown as PrismaClient;

        expect(
          await new PrismaAuthzMigrationRepository(prisma).findUsersByEmail({
            emails: ["%"],
          }),
        ).toEqual([]);
      });
    });

    describe("when no addresses are asked about", () => {
      it("asks the database nothing", async () => {
        const findMany = vi.fn();
        const prisma = { user: { findMany } } as unknown as PrismaClient;

        expect(
          await new PrismaAuthzMigrationRepository(prisma).findUsersByEmail({
            emails: [],
          }),
        ).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * @vitest-environment node
 *
 * specs/server/prisma-driver-adapter.feature — the tenancy guard chain
 * (enMasse → projectId → organizationId, plus the raw-SQL guard) used to hang
 * off Prisma's `$use`, which Prisma 7 removed; it now installs as a query
 * extension in `~/server/db`. The guards' own semantics are unit-tested
 * against the guard functions directly — what nothing else covers is the
 * WIRING: that every guard is actually present on the exported client, and
 * that guardEnMasse's argument rewrite (the only guard that mutates args
 * rather than just validating) survives the extension's argument plumbing.
 * Each test here drives a real query through the exported client against the
 * real test database.
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import { prisma } from "../db";

describe("the tenancy guard chain on the exported client", () => {
  describe("when a project-scoped model is queried without a tenant filter", () => {
    /** @scenario "A project-scoped query without a tenant filter is refused" */
    it("refuses the query before it reaches the database", async () => {
      await expect(prisma.dataset.findMany({ where: {} })).rejects.toThrow(
        /projectId/,
      );
    });
  });

  describe("when an organization-scoped model is queried without its anchor", () => {
    /** @scenario "An organization-scoped query without its anchor is refused" */
    it("refuses the query before it reaches the database", async () => {
      await expect(prisma.team.findMany({})).rejects.toThrow(/organizationId/);
    });
  });

  describe("when a deleteMany names an empty where clause", () => {
    /** @scenario "A mass delete without the safe word is refused" */
    it("refuses the query and names the safe word", async () => {
      await expect(
        prisma.verificationToken.deleteMany({ where: {} }),
      ).rejects.toThrow(/FORCE_DELETE_ALL/);
    });
  });

  describe("when a deleteMany passes the safe word", () => {
    /** @scenario "The mass-delete safe word deletes every row" */
    it("rewrites the safe word away and deletes every row", async () => {
      const identifier = `guard-wiring-${nanoid()}`;
      await prisma.verificationToken.createMany({
        data: [1, 2].map((n) => ({
          identifier,
          token: `${identifier}-${n}`,
          expires: new Date(Date.now() + 60_000),
        })),
      });

      const { count } = await prisma.verificationToken.deleteMany({
        where: { id: "FORCE_DELETE_ALL" },
      });

      // The rewrite turned the safe word into an empty where: at least our
      // two rows went, and none survived. A dropped rewrite would instead
      // delete zero rows (no row's id is the safe word) and fail both checks.
      expect(count).toBeGreaterThanOrEqual(2);
      expect(
        await prisma.verificationToken.count({ where: { identifier } }),
      ).toBe(0);
    });
  });

  describe("when raw SQL names no tenancy column", () => {
    /** @scenario "Raw SQL without a tenancy predicate is refused, also inside a transaction" */
    it("refuses it directly and inside an interactive transaction", async () => {
      await expect(prisma.$queryRaw`SELECT 1 AS probe`).rejects.toThrow(
        /tenancy predicate/,
      );

      // v10's `$use` never saw template-literal raw SQL inside interactive
      // transactions; the query extension does. This is the regression test
      // for that widened surface.
      await expect(
        prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1 AS probe`),
      ).rejects.toThrow(/tenancy predicate/);
    });
  });

  describe("when raw SQL carries the sanctioned tenancy marker", () => {
    /** @scenario "Raw SQL with the sanctioned tenancy marker runs" */
    it("reaches the database and returns rows", async () => {
      const rows = await prisma.$queryRaw<{ probe: number }[]>`
        -- @tenancy: guard-wiring test probe (no tenant data touched)
        SELECT 1 AS probe
      `;
      expect(rows).toHaveLength(1);
    });
  });
});

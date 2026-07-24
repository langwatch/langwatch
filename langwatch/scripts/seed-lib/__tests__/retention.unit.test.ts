import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  RETENTION_CATEGORIES,
  RETENTION_WEEK_DAYS,
  SEEDED_RETENTION_DAYS,
  applySeedRetention,
  seededRetentionDays,
} from "../retention";

describe("seededRetentionDays", () => {
  describe("given a window well inside two years", () => {
    // @scenario "A seeded database keeps two years of partition-aligned history"
    it("pins exactly two years rounded down to whole weeks", () => {
      // 2 years = 730 days, minus (730 mod 7) = 728, i.e. 104 whole weeks.
      expect(SEEDED_RETENTION_DAYS).toBe(728);
      expect(SEEDED_RETENTION_DAYS % RETENTION_WEEK_DAYS).toBe(0);
      for (const windowDays of [0, 30, 90, 300, 600]) {
        expect(seededRetentionDays(windowDays)).toBe(728);
      }
    });
  });

  describe("given a window deeper than two years", () => {
    // @scenario "A deeper seed window scales retention up to outlive it"
    it("scales up to outlive the window and stays partition-aligned", () => {
      const windowDays = 900;
      const days = seededRetentionDays(windowDays);
      expect(days).toBeGreaterThan(windowDays);
      expect(days).toBeGreaterThan(SEEDED_RETENTION_DAYS);
      expect(days % RETENTION_WEEK_DAYS).toBe(0);
    });
  });
});

interface FakeRow {
  category: string;
  retentionDays: number;
}

function fakePrisma(seed: FakeRow[] = []): {
  prisma: PrismaClient;
  rows: Map<string, FakeRow>;
} {
  const rows = new Map(seed.map((r) => [r.category, r]));
  const prisma = {
    retentionPolicy: {
      findUnique: async ({
        where,
      }: {
        where: { scopeType_scopeId_category: { category: string } };
      }) => rows.get(where.scopeType_scopeId_category.category) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { scopeType_scopeId_category: { category: string } };
        create: FakeRow;
      }) => {
        rows.set(where.scopeType_scopeId_category.category, {
          category: create.category,
          retentionDays: create.retentionDays,
        });
        return create;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

describe("applySeedRetention", () => {
  describe("given a fresh database with no override", () => {
    // @scenario "Pinning seed retention writes every category once"
    it("upserts every retention category and reports a change", async () => {
      const { prisma, rows } = fakePrisma();
      const changed = await applySeedRetention({
        prisma,
        organizationId: "local-dev-organization",
        retentionDays: SEEDED_RETENTION_DAYS,
      });
      expect(changed).toBe(true);
      expect(rows.size).toBe(RETENTION_CATEGORIES.length);
      for (const category of RETENTION_CATEGORIES) {
        expect(rows.get(category)?.retentionDays).toBe(SEEDED_RETENTION_DAYS);
      }
    });
  });

  describe("given the policy is already at the target", () => {
    // @scenario "Re-pinning seed retention is a no-op"
    it("changes nothing and never triggers the cache wait", async () => {
      const seeded = RETENTION_CATEGORIES.map((category) => ({
        category,
        retentionDays: SEEDED_RETENTION_DAYS,
      }));
      const { prisma } = fakePrisma(seeded);
      // waitForCacheRollover:true would hang the test for 65s if it fired; an
      // unchanged run must never reach it.
      const changed = await applySeedRetention({
        prisma,
        organizationId: "local-dev-organization",
        retentionDays: SEEDED_RETENTION_DAYS,
        waitForCacheRollover: true,
      });
      expect(changed).toBe(false);
    });
  });
});

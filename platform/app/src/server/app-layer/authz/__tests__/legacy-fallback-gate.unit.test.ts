/**
 * The per-organization cache behind ./legacy-fallback-gate.ts never revisits
 * an entry once written, so without a bound an org queried once and never
 * again would hold its entry for the life of the pod. This covers the bound
 * through the gate that uses it: once the map is full, writing a new entry
 * evicts rather than growing past `MAX_CACHE_ENTRIES`.
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  legacyTeamFallbackDisabled,
  resetLegacyFallbackGateForTesting,
} from "../legacy-fallback-gate";
import { MAX_CACHE_ENTRIES } from "../per-organization-cached-gate";

function fakePrisma(): {
  prisma: Pick<PrismaClient, "systemMigrationTenantState">;
  callCount: () => number;
} {
  let calls = 0;
  const prisma = {
    systemMigrationTenantState: {
      findUnique: async () => {
        calls++;
        return null;
      },
    },
  } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;
  return { prisma, callCount: () => calls };
}

describe("legacyTeamFallbackDisabled", () => {
  describe("when more organizations are queried than the cache can hold", () => {
    it("evicts the oldest entry instead of growing without bound", async () => {
      resetLegacyFallbackGateForTesting();
      const { prisma, callCount } = fakePrisma();

      await legacyTeamFallbackDisabled({ prisma, organizationId: "org-0" });
      const callsAfterFirstQuery = callCount();

      for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
        await legacyTeamFallbackDisabled({
          prisma,
          organizationId: `org-${i}`,
        });
      }

      // "org-0" was the oldest entry; once the cache filled up it must have
      // been evicted, so re-asking about it hits storage again rather than
      // answering from a still-cached entry.
      await legacyTeamFallbackDisabled({ prisma, organizationId: "org-0" });
      expect(callCount()).toBeGreaterThan(
        callsAfterFirstQuery + MAX_CACHE_ENTRIES,
      );
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

import {
  __resetCostAttributionCacheForTests,
  resolveSourceNonBillable,
} from "../costAttributionPolicy.service";

function fakePrisma(tiles: Array<{ config: unknown }>): PrismaClient {
  return {
    aiToolEntry: {
      findMany: vi.fn().mockResolvedValue(tiles),
    },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  __resetCostAttributionCacheForTests();
});

describe("resolveSourceNonBillable", () => {
  describe("when no catalog tile matches the source", () => {
    it("defaults the OTLP/ingest path to non-billable (bundled)", async () => {
      const result = await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_code",
        prisma: fakePrisma([]),
      });
      expect(result).toBe(true);
    });
  });

  describe("when the matching tile opts into per-token billing", () => {
    it("returns false (billed) for bundledPlan === false", async () => {
      const result = await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_code",
        prisma: fakePrisma([
          { config: { assistantKind: "claude_code", bundledPlan: false } },
        ]),
      });
      expect(result).toBe(false);
    });
  });

  describe("when the matching tile is bundled or leaves the flag absent", () => {
    it("returns true for bundledPlan === true", async () => {
      expect(
        await resolveSourceNonBillable({
          organizationId: "org_1",
          sourceType: "codex",
          prisma: fakePrisma([
            { config: { assistantKind: "codex", bundledPlan: true } },
          ]),
        }),
      ).toBe(true);
    });

    it("returns true when bundledPlan is omitted", async () => {
      expect(
        await resolveSourceNonBillable({
          organizationId: "org_1",
          sourceType: "gemini",
          prisma: fakePrisma([{ config: { assistantKind: "gemini" } }]),
        }),
      ).toBe(true);
    });
  });

  describe("when a different tool is set to billed", () => {
    it("does not leak the override to an unrelated source", async () => {
      const result = await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "opencode",
        prisma: fakePrisma([
          { config: { assistantKind: "claude_code", bundledPlan: false } },
        ]),
      });
      expect(result).toBe(true);
    });
  });

  /**
   * Cowork and Claude Code are the one pair this join can plausibly confuse:
   * same vendor, same runtime, same brand mark, and adjacent in the agent
   * registry. Until `claude_cowork` was accepted as an assistant kind no tile
   * could carry it, so the Cowork half of this join had no live left-hand side
   * and nothing here could be asserted. These pin both directions, because the
   * cheap way to "simplify" this is to fold Cowork into Claude Code, and that
   * would move money without failing a test.
   */
  describe("when the organization runs both Cowork and Claude Code", () => {
    it("bills Cowork when the Cowork tile is unticked", async () => {
      const result = await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_cowork",
        prisma: fakePrisma([
          { config: { assistantKind: "claude_cowork", bundledPlan: false } },
        ]),
      });
      expect(result).toBe(false);
    });

    it("leaves Cowork bundled when only the Claude Code tile is unticked", async () => {
      const result = await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_cowork",
        prisma: fakePrisma([
          { config: { assistantKind: "claude_code", bundledPlan: false } },
        ]),
      });
      expect(result).toBe(true);
    });

    it("leaves Claude Code bundled when only the Cowork tile is unticked", async () => {
      const result = await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_code",
        prisma: fakePrisma([
          { config: { assistantKind: "claude_cowork", bundledPlan: false } },
        ]),
      });
      expect(result).toBe(true);
    });
  });

  describe("caching", () => {
    it("serves the second lookup from cache without re-querying", async () => {
      const prisma = fakePrisma([
        { config: { assistantKind: "claude_code", bundledPlan: false } },
      ]);
      await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_code",
        prisma,
      });
      await resolveSourceNonBillable({
        organizationId: "org_1",
        sourceType: "claude_code",
        prisma,
      });
      expect(prisma.aiToolEntry.findMany).toHaveBeenCalledTimes(1);
    });
  });
});

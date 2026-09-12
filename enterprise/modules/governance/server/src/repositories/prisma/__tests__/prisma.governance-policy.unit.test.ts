import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaGovernanceRepository, type GovernanceDatabase } from "../prisma.governance.repository.ts";

class PolicyHarness {
  private constructor(
    readonly findMany: ReturnType<typeof vi.fn>,
    readonly policy: ReturnType<
      ReturnType<typeof PrismaGovernanceRepository.create>["build"]
    >["policy"],
  ) {}

  static create(tiles: Array<{ config: unknown }>): PolicyHarness {
    const findMany = vi.fn().mockResolvedValue(tiles);
    const database = {
      aiToolEntry: {
        findMany,
      },
    } as GovernanceDatabase;
    return new PolicyHarness(
      findMany,
      PrismaGovernanceRepository.create({ database }).build().policy,
    );
  }

  resolve(input: { organizationId: string; sourceType: string }): Promise<boolean> {
    return this.policy.resolveSourceNonBillable(input);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSourceNonBillable", () => {
  describe("when no catalog tile matches the source", () => {
    it("defaults the OTLP/ingest path to non-billable (bundled)", async () => {
      const result = await PolicyHarness.create([]).resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      expect(result).toBe(true);
    });
  });

  describe("when the matching tile opts into per-token billing", () => {
    it("returns false (billed) for bundledPlan === false", async () => {
      const result = await PolicyHarness.create([
        { config: { assistantKind: "claude_code", bundledPlan: false } },
      ]).resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      expect(result).toBe(false);
    });
  });

  describe("when the matching tile is bundled or leaves the flag absent", () => {
    it("returns true for bundledPlan === true", async () => {
      expect(
        await PolicyHarness.create([
          { config: { assistantKind: "codex", bundledPlan: true } },
        ]).resolve({
          organizationId: "org_1",
          sourceType: "codex",
        }),
      ).toBe(true);
    });

    it("returns true when bundledPlan is omitted", async () => {
      expect(
        await PolicyHarness.create([{ config: { assistantKind: "gemini" } }]).resolve({
          organizationId: "org_1",
          sourceType: "gemini",
        }),
      ).toBe(true);
    });
  });

  describe("when a different tool is set to billed", () => {
    it("does not leak the override to an unrelated source", async () => {
      const result = await PolicyHarness.create([
        { config: { assistantKind: "claude_code", bundledPlan: false } },
      ]).resolve({
        organizationId: "org_1",
        sourceType: "opencode",
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
      const harness = PolicyHarness.create([
        { config: { assistantKind: "claude_code", bundledPlan: false } },
      ]);
      await harness.resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      await harness.resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      expect(harness.findMany).toHaveBeenCalledTimes(1);
    });
  });
});

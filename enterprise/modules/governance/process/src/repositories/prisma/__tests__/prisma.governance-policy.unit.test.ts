import { beforeEach, describe, expect, it, vi } from "vitest";

import { PostgresGovernancePolicyService } from "../../../services/governance-policy.service.ts";
import { PrismaCostAttributionPolicyRepository } from "../prisma.cost-attribution-policy.repository.ts";

class PolicyHarness {
  private constructor(
    readonly findMany: ReturnType<typeof vi.fn>,
    readonly policy: PostgresGovernancePolicyService,
  ) {}

  static create(tiles: { config: unknown }[]): PolicyHarness {
    const findMany = vi.fn().mockResolvedValue(tiles);
    const database = {
      aiToolEntry: {
        findMany,
      },
    };
    return new PolicyHarness(
      findMany,
      PostgresGovernancePolicyService.create(
        PrismaCostAttributionPolicyRepository.create(database),
      ),
    );
  }

  resolve(input: { organizationId: string; sourceType: string }): Promise<boolean> {
    return this.policy.isSourceBilled(input);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isSourceBilled", () => {
  describe("when no catalog tile matches the source", () => {
    it("defaults the OTLP/ingest path to not billed (bundled)", async () => {
      const result = await PolicyHarness.create([]).resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      expect(result).toBe(false);
    });
  });

  describe("when the matching tile opts into per-token billing", () => {
    it("returns true (billed) for bundledPlan === false", async () => {
      const result = await PolicyHarness.create([
        { config: { assistantKind: "claude_code", bundledPlan: false } },
      ]).resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      expect(result).toBe(true);
    });
  });

  describe("when the matching tile is bundled or leaves the flag absent", () => {
    it("returns false for bundledPlan === true", async () => {
      expect(
        await PolicyHarness.create([
          { config: { assistantKind: "codex", bundledPlan: true } },
        ]).resolve({
          organizationId: "org_1",
          sourceType: "codex",
        }),
      ).toBe(false);
    });

    it("returns false when bundledPlan is omitted", async () => {
      expect(
        await PolicyHarness.create([{ config: { assistantKind: "gemini" } }]).resolve({
          organizationId: "org_1",
          sourceType: "gemini",
        }),
      ).toBe(false);
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
      expect(result).toBe(false);
    });
  });

  // Cowork and Claude Code must be billed separately despite looking similar.
  describe("when the organization runs both Cowork and Claude Code", () => {
    it("bills Cowork when the Cowork tile is unticked", async () => {
      const result = await PolicyHarness.create([
        { config: { assistantKind: "claude_cowork", bundledPlan: false } },
      ]).resolve({
        organizationId: "org_1",
        sourceType: "claude_cowork",
      });
      expect(result).toBe(true);
    });

    it("leaves Cowork bundled when only the Claude Code tile is unticked", async () => {
      const result = await PolicyHarness.create([
        { config: { assistantKind: "claude_code", bundledPlan: false } },
      ]).resolve({
        organizationId: "org_1",
        sourceType: "claude_cowork",
      });
      expect(result).toBe(false);
    });

    it("leaves Claude Code bundled when only the Cowork tile is unticked", async () => {
      const result = await PolicyHarness.create([
        { config: { assistantKind: "claude_cowork", bundledPlan: false } },
      ]).resolve({
        organizationId: "org_1",
        sourceType: "claude_code",
      });
      expect(result).toBe(false);
    });
  });

  describe("given the policy is already cached", () => {
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

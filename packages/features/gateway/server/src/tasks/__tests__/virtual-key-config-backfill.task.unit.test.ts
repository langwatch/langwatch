import { describe, expect, it, vi } from "vitest";
import {
  type BackfillJsonObject,
  GatewayVirtualKeyConfigBackfillRepository,
  type MintGuardrailInput,
  type MintRoutingPolicyInput,
  type VirtualKeyRow,
} from "../../repositories/gateway-virtual-key-config-backfill.repository";
import { backfillVirtualKeyConfig } from "../virtual-key-config-backfill.task";

function fakeRepository(virtualKeys: VirtualKeyRow[]) {
  const updates: Array<{
    id: string;
    config: BackfillJsonObject;
    routingPolicyId: string | null;
  }> = [];
  let guardrailCount = 0;
  const mintRoutingPolicy = vi.fn(async (input: MintRoutingPolicyInput) => input.id);
  const mintGuardrail = vi.fn(async (_input: MintGuardrailInput) => {
    guardrailCount += 1;
    return `gr-${guardrailCount}`;
  });

  class FakeRepository extends GatewayVirtualKeyConfigBackfillRepository {
    async findOrganizationIds(): Promise<string[]> {
      return ["org-1"];
    }

    async findVirtualKeys(): Promise<VirtualKeyRow[]> {
      return virtualKeys;
    }

    mintRoutingPolicy = mintRoutingPolicy;
    mintGuardrail = mintGuardrail;

    async updateVirtualKeyConfig(input: {
      id: string;
      config: BackfillJsonObject;
      routingPolicyId: string | null;
    }): Promise<void> {
      updates.push(input);
    }
  }

  return { repository: new FakeRepository(), updates, mintRoutingPolicy, mintGuardrail };
}

function virtualKey(overrides: Partial<VirtualKeyRow>): VirtualKeyRow {
  return {
    id: "vk-1",
    name: "prod",
    organizationId: "org-1",
    routingPolicyId: null,
    config: {},
    scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
    ...overrides,
  } as VirtualKeyRow;
}

describe("backfillVirtualKeyConfig", () => {
  describe("given a key carrying legacy aliases and guardrails", () => {
    /** @scenario "The virtual-key config backfill mints the rows that replaced the legacy keys" */
    it("mints a routing policy and a guardrail per reference, then strips the legacy keys", async () => {
      const { repository, updates, mintRoutingPolicy, mintGuardrail } = fakeRepository([
        virtualKey({
          config: {
            modelAliases: { fast: "gpt-5-mini" },
            guardrails: { pre: [{ id: "eval-1", evaluator: "pii" }], requestFailOpen: true },
            keepMe: "untouched",
          },
          scopes: [
            { scopeType: "PROJECT", scopeId: "project-1" },
            { scopeType: "TEAM", scopeId: "team-1" },
          ],
        }),
      ]);

      const outcome = await backfillVirtualKeyConfig({ repository, execute: true });

      expect(outcome.routingPoliciesMinted).toBe(1);
      expect(outcome.guardrailsMinted).toBe(1);
      expect(mintRoutingPolicy.mock.calls[0]?.[0].scopes).toEqual([
        { scopeType: "PROJECT", scopeId: "project-1" },
        { scopeType: "TEAM", scopeId: "team-1" },
      ]);
      expect(mintGuardrail.mock.calls[0]?.[0].failureMode).toBe("FAIL_OPEN");
      expect(updates[0]?.config).toEqual({
        keepMe: "untouched",
        guardrailAttachments: [{ direction: "pre", guardrailIds: ["gr-1"] }],
      });
    });
  });

  describe("when a key with guardrails is held at team scope only", () => {
    /** @scenario "The virtual-key config backfill refuses to guess a project for a guardrail" */
    it("reports the skip and mints no guardrail", async () => {
      const { repository, updates, mintGuardrail } = fakeRepository([
        virtualKey({
          config: { guardrails: { post: [{ id: "eval-1", evaluator: "pii" }] } },
          scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
        }),
      ]);

      const outcome = await backfillVirtualKeyConfig({ repository, execute: true });

      expect(outcome.skippedWithoutProjectScope).toBe(1);
      expect(outcome.guardrailsMinted).toBe(0);
      expect(mintGuardrail).not.toHaveBeenCalled();
      expect(updates[0]?.config).toEqual({});
    });
  });

  describe("when a key was already migrated", () => {
    /** @scenario "The virtual-key config backfill is safe to re-run" */
    it("is left alone entirely", async () => {
      const { repository, updates, mintRoutingPolicy } = fakeRepository([
        virtualKey({ config: { guardrailAttachments: [] }, routingPolicyId: "rp-1" }),
      ]);

      const outcome = await backfillVirtualKeyConfig({ repository, execute: true });

      expect(outcome.touched).toBe(0);
      expect(updates).toEqual([]);
      expect(mintRoutingPolicy).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  backfillVirtualKeyConfig,
  type VirtualKeyConfigBackfillDatabase,
  type VirtualKeyRow,
} from "../virtual-key-config-backfill.task";

/**
 * The picked delegates return branded `PrismaPromise` values, so the double is
 * built untyped and cast once at the seam, and the spies are returned rather
 * than reached for through the typed handle.
 */
function fakeDatabase(virtualKeys: VirtualKeyRow[]) {
  const updates: Array<{
    id: string;
    config: Record<string, unknown>;
    routingPolicyId: string | null;
  }> = [];
  let guardrailCount = 0;
  const createPolicy = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: String(data.id),
  }));
  const createGuardrail = vi.fn(async (_args: { data: Record<string, unknown> }) => {
    guardrailCount += 1;
    return { id: `gr-${guardrailCount}` };
  });
  const database = {
    organization: { findMany: vi.fn(async () => [{ id: "org-1" }]) },
    virtualKey: {
      findMany: vi.fn(async () => virtualKeys),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { config: Record<string, unknown>; routingPolicyId: string | null };
        }) => {
          updates.push({
            id: where.id,
            config: data.config,
            routingPolicyId: data.routingPolicyId,
          });
        },
      ),
    },
    routingPolicy: { create: createPolicy },
    gatewayGuardrail: { create: createGuardrail },
  } as unknown as VirtualKeyConfigBackfillDatabase;
  return { database, updates, createPolicy, createGuardrail };
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
      const { database, updates, createPolicy, createGuardrail } = fakeDatabase([
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

      const outcome = await backfillVirtualKeyConfig({ database, execute: true });

      expect(outcome.routingPoliciesMinted).toBe(1);
      expect(outcome.guardrailsMinted).toBe(1);
      const policy = createPolicy.mock.calls[0]?.[0].data;
      expect(policy?.scopes).toEqual({
        create: [
          { scopeType: "PROJECT", scopeId: "project-1" },
          { scopeType: "TEAM", scopeId: "team-1" },
        ],
      });
      expect(createGuardrail.mock.calls[0]?.[0].data.failureMode).toBe("FAIL_OPEN");
      expect(updates[0]?.config).toEqual({
        keepMe: "untouched",
        guardrailAttachments: [{ direction: "pre", guardrailIds: ["gr-1"] }],
      });
    });
  });

  describe("when a key with guardrails is held at team scope only", () => {
    /** @scenario "The virtual-key config backfill refuses to guess a project for a guardrail" */
    it("reports the skip and mints no guardrail", async () => {
      const { database, updates, createGuardrail } = fakeDatabase([
        virtualKey({
          config: { guardrails: { post: [{ id: "eval-1", evaluator: "pii" }] } },
          scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
        }),
      ]);

      const outcome = await backfillVirtualKeyConfig({ database, execute: true });

      expect(outcome.skippedWithoutProjectScope).toBe(1);
      expect(outcome.guardrailsMinted).toBe(0);
      expect(createGuardrail).not.toHaveBeenCalled();
      expect(updates[0]?.config).toEqual({});
    });
  });

  describe("when a key was already migrated", () => {
    /** @scenario "The virtual-key config backfill is safe to re-run" */
    it("is left alone entirely", async () => {
      const { database, updates, createPolicy } = fakeDatabase([
        virtualKey({ config: { guardrailAttachments: [] }, routingPolicyId: "rp-1" }),
      ]);

      const outcome = await backfillVirtualKeyConfig({ database, execute: true });

      expect(outcome.touched).toBe(0);
      expect(updates).toEqual([]);
      expect(createPolicy).not.toHaveBeenCalled();
    });
  });
});

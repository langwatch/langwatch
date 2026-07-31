import { describe, expect, it, vi } from "vitest";
import {
  attributedUserBucketScopeId,
  resolveApplicableBudgets,
} from "../budgetResolution.service";

/**
 * Resolution unit over a stubbed Prisma: the queries this service runs are
 * findMany over budgets and group memberships, so a two-method stub is the
 * whole database.
 */
function prismaStub(budgets: unknown[]) {
  return {
    gatewayBudget: { findMany: vi.fn().mockResolvedValue(budgets) },
    groupMember: { findMany: vi.fn().mockResolvedValue([]) },
    group: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
}

const template = (over: Record<string, unknown> = {}) => ({
  id: "budget_tpl",
  organizationId: "org_1",
  scopeType: "ATTRIBUTED_USER",
  scopeId: "vk_anchor",
  providerKey: null,
  window: "MONTH",
  ...over,
});

describe("attributed-user template resolution", () => {
  /** @scenario A template resolves to the request's own bucket when the end user is known */
  it("buckets by anchor and end user, provider filter riding the suffix", async () => {
    const resolved = await resolveApplicableBudgets(
      prismaStub([template(), template({ id: "budget_tpl_openai", providerKey: "mp_openai" })]),
      {
        organizationId: "org_1",
        virtualKeyId: "vk_anchor",
        endUserId: "end_user_42",
      },
    );
    const plain = resolved.find((r) => r.budget.id === "budget_tpl")!;
    expect(plain.bucketScopeId).toBe(
      attributedUserBucketScopeId("vk_anchor", "end_user_42"),
    );
    expect(plain.bucketScopeId).toBe("vk_anchor:end_user_42");
    expect(plain.endUserId).toBe("end_user_42");

    const filtered = resolved.find((r) => r.budget.id === "budget_tpl_openai")!;
    expect(filtered.bucketScopeId).toBe(
      "vk_anchor:end_user_42|provider:mp_openai",
    );
  });

  /** @scenario A template resolves as itself when no end user is in context */
  it("resolves the bare template without an end user", async () => {
    const resolved = await resolveApplicableBudgets(
      prismaStub([template()]),
      { organizationId: "org_1", virtualKeyId: "vk_anchor" },
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.bucketScopeId).toBe("vk_anchor");
    expect(resolved[0]!.endUserId).toBeNull();
  });
});

import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * `gatewayBudgets.personalBudget`: the /me banner's door, as main's `user.personalBudget`
 * declared it (organization:view, `{ organizationId }` in, the banner state out).
 * @see modules/gateway/specs/gateway-personal-budget.feature
 */
import { type GatewayApi, gatewayBudgetTrpc } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { gatewayBudgetTrpcTransport } from "../gateway-budget.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

const warning = {
  status: "warning" as const,
  scope: "principal",
  spentUsd: "85",
  limitUsd: "100",
  period: "month",
  adminEmail: "it@example.com",
};

function callerFor({ permits }: { permits: (permission: string) => boolean }) {
  const getPersonalBudget = vi.fn(async () => warning);
  const asked: string[] = [];
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<GatewayTrpcTestContext>({
      permits: (permission) => {
        asked.push(permission);
        return permits(permission);
      },
    }),
  }).mount(gatewayBudgetTrpcTransport, () => createApiFixture<GatewayApi>({ getPersonalBudget }));

  return { caller: router.createCaller({ actor: { id: "user-1" } }), getPersonalBudget, asked };
}

describe("gatewayBudgets.personalBudget", () => {
  describe("given the declaration the browser's banner reads", () => {
    /** @scenario "The /me budget banner is served by the gateway on the same terms" */
    it("is a query in the gatewayBudgets namespace", () => {
      expect(gatewayBudgetTrpcTransport.namespace).toBe("gatewayBudgets");
      expect(gatewayBudgetTrpc.members.personalBudget?.kind).toBe("query");
    });
  });

  describe("given a member who may view the organization", () => {
    it("answers the caller's own banner after asking organization:view", async () => {
      const { caller, getPersonalBudget, asked } = callerFor({ permits: () => true });

      const budget = await caller.personalBudget({ organizationId: "org-1" });

      expect(budget).toEqual(warning);
      expect(asked).toEqual(["organization:view"]);
      expect(getPersonalBudget).toHaveBeenCalledWith({ userId: "user-1", organizationId: "org-1" });
    });
  });

  describe("given a caller without organization:view", () => {
    it("refuses before the application is asked", async () => {
      const { caller, getPersonalBudget } = callerFor({ permits: () => false });

      await expect(caller.personalBudget({ organizationId: "org-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getPersonalBudget).not.toHaveBeenCalled();
    });
  });
});

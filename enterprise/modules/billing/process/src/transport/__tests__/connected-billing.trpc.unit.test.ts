import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { BillingApi, BillingStaff } from "@langwatch/enterprise-billing-contract";
import { AdminSurfaceHiddenError, type OpsOperator } from "@langwatch/ops-contract";
/**
 * @vitest-environment node
 * The `connectedBilling.*` surface: which staff member the mount hands billing for the operator
 * behind the request, and that an impersonator billing cannot name is refused.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { connectedBillingTrpcTransport, operatorFact } from "../connected-billing.trpc.ts";
import { billingTrpcTestMembers, type BillingTrpcTestContext } from "./billing.trpc.harness.ts";

const CUSTOMER = { id: "user_customer", email: "admin@acme.example" };

/** Billing as the mount reaches it: records who it was asked as, and refuses everybody. */
function mounted() {
  const askedAs: (BillingStaff | null)[] = [];
  const billing = createApiFixture<BillingApi>({
    getConnectedBillingOverview: async (_input, by) => {
      askedAs.push(by);
      throw new AdminSurfaceHiddenError();
    },
  });
  const trpc = initTRPC.context<BillingTrpcTestContext>().create();
  const router = createTrpcRuntime<BillingTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: billingTrpcTestMembers(),
  }).mount(connectedBillingTrpcTransport, () => billing, {
    facts: [bindTrpcFact(operatorFact, (ctx) => ctx.operator ?? null)],
  });
  const read = async (operator: OpsOperator) => {
    const failure = await router
      .createCaller({ actor: { id: operator.id }, operator })
      .get({ organizationId: "org_acme" })
      .catch((error: unknown) => error);
    return { askedAs, failure };
  };

  return { read };
}

describe("given an operator impersonating a customer", () => {
  describe("when the impersonator's id is known", () => {
    it("asks billing as the impersonator, never the customer", async () => {
      const { read } = mounted();

      const { askedAs } = await read({
        ...CUSTOMER,
        impersonator: { id: "user_operator", email: "ops@langwatch.example" },
      });

      expect(askedAs).toEqual([{ id: "user_operator", email: "ops@langwatch.example" }]);
    });
  });

  describe("when the impersonator carries no id", () => {
    /** @scenario "An impersonated back-office call with no impersonator id is refused" */
    it("refuses before billing is asked, and never asks as the customer", async () => {
      const { read } = mounted();

      const { askedAs, failure } = await read({
        ...CUSTOMER,
        impersonator: { email: "ops@langwatch.example" },
      });

      expect(failure).toMatchObject({ message: "Not found" });
      expect(askedAs).toEqual([]);
    });
  });
});

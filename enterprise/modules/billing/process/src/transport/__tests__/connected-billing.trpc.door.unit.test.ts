import {
  bindTrpcFact,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * Connected billing behind the platform door (Q42/Q44): non-staff 404, staff lacking ops:manage
 * refused a write by name, anonymous 401; billing is never reached. Spec: billing.feature.
 */
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { connectedBillingTrpcTransport, operatorFact } from "../connected-billing.trpc.ts";

type Context = { actor: { type: "user"; id: string } | null; operator: OpsOperator | null };

const GRANTS: Readonly<Record<string, readonly string[]>> = {
  "user-viewer": ["ops:view"],
  "user-staff": ["ops:view", "ops:manage"],
};

const root = TrpcRootDefinition.forContext<Context>().create({});

function members(): TrpcRuntimeMembers<Context> {
  return {
    identity: { caller: (ctx) => ({ actor: ctx.actor }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: (GRANTS[userId] ?? []).includes(permission),
        }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

function billingBackOffice(reached: string[]) {
  const reach = (name: string) => async () => {
    reached.push(name);
    throw new Error("the door admitted the caller");
  };
  const app = createApiFixture<BillingApi>({
    getConnectedBillingOverview: reach("getConnectedBillingOverview"),
    onboardConnectedCustomer: reach("onboardConnectedCustomer"),
    addConnectedCommit: reach("addConnectedCommit"),
    renewConnectedTerm: reach("renewConnectedTerm"),
    completeConnectedRenewalIfDue: reach("completeConnectedRenewalIfDue"),
    markConnectedInvoicePaidOutOfBand: reach("markConnectedInvoicePaidOutOfBand"),
  });
  const runtime = createTrpcRuntime<Context>({
    root,
    procedure: root.procedure,
    members: members(),
  });
  const facts = { facts: [bindTrpcFact(operatorFact, (ctx: Context) => ctx.operator)] };
  const as = (id: string | null) => ({
    actor: id ? ({ type: "user", id } as const) : null,
    operator: id ? { id, email: `${id}@langwatch.test` } : null,
  });

  return (id: string | null) =>
    runtime.mount(connectedBillingTrpcTransport, () => app, facts).createCaller(as(id));
}

function codeOf(failure: unknown): { trpc: string; code: string } {
  const error = failure as { code: string; cause?: { code?: string } };

  return { trpc: error.code, code: error.cause?.code ?? "" };
}

const ORGANIZATION = { organizationId: "org_acme" };
const TERMS = {
  ...ORGANIZATION,
  termStartsAt: "2027-10-01T00:00:00Z",
  termEndsAt: "2028-10-01T00:00:00Z",
  seats: 10,
  seatRateCents: 50_00,
  seatCurrency: "USD" as const,
  commitUsdCents: 100_00,
};

describe("connected billing at the platform door", () => {
  describe("when someone who is not staff reads or writes a customer's billing", () => {
    /** @scenario "Someone who is not staff is answered not-found by the connected-billing door" */
    it("refuses not_found before the application, and an anonymous caller 401", async () => {
      const reached: string[] = [];
      const billing = billingBackOffice(reached);

      const stranger = billing("user-stranger");
      const read = await stranger.get(ORGANIZATION).catch((error: unknown) => error);
      const write = await stranger
        .addCommit({ ...ORGANIZATION, amountUsdCents: 100 })
        .catch((error: unknown) => error);
      const anonymous = await billing(null)
        .get(ORGANIZATION)
        .catch((error: unknown) => error);

      expect(codeOf(read)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(codeOf(write)).toEqual({ trpc: "NOT_FOUND", code: "not_found" });
      expect(codeOf(anonymous).trpc).toBe("UNAUTHORIZED");
      expect(reached).toEqual([]);
    });
  });

  describe("when a view-only operator reads, then writes", () => {
    /** @scenario "A view-only operator reads the billing overview but is refused on every billing write" */
    it("admits the read and refuses every write with permission_denied", async () => {
      const reached: string[] = [];
      const viewer = billingBackOffice(reached)("user-viewer");
      const refusals = await Promise.all([
        viewer
          .onboard({ ...TERMS, organizationName: "Acme", billingEmail: "finance@acme.example" })
          .catch((error: unknown) => error),
        viewer.addCommit({ ...ORGANIZATION, amountUsdCents: 100 }).catch((error: unknown) => error),
        viewer.renew(TERMS).catch((error: unknown) => error),
        viewer.completeRenewalIfDue(ORGANIZATION).catch((error: unknown) => error),
        viewer.markPaidOutOfBand({ stripeInvoiceId: "in_1" }).catch((error: unknown) => error),
      ]);
      await viewer.get(ORGANIZATION).catch(() => void 0);

      expect(refusals.map(codeOf)).toEqual(
        refusals.map(() => ({ trpc: "FORBIDDEN", code: "permission_denied" })),
      );
      expect(reached).toEqual(["getConnectedBillingOverview"]);
    });
  });
});

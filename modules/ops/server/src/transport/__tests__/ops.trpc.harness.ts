/**
 * The process members a mounted ops declaration runs on: one signed-in
 * person and an authorization answer, both test-supplied. The operator
 * gate is not here - it is the application's, changed via `opsOperator`.
 */
import type { TrpcRuntimeMembers } from "@langwatch/api/trpc";

/** What a mount reads off the request: who is asking. */
export type OpsTrpcTestContext = { actor: { id: string } };

export function opsTrpcTestMembers(): TrpcRuntimeMembers<OpsTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
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

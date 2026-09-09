/**
 * The process ports a mounted ops declaration runs on, as a test supplies
 * them: one signed-in person and an authorization answer the test decides.
 *
 * The operator gate is NOT here. It is the application's - the deployment's
 * own allow-list, checked in the handler - so a test moves it by changing who
 * the `opsOperator` fact answers with, not by changing these ports.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: who is asking. */
export type OpsTrpcTestContext = { actor: { id: string } };

export function opsTrpcTestPorts(): TrpcRuntimePorts<OpsTrpcTestContext> {
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

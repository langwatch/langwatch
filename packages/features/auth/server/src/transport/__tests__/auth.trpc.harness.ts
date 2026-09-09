/**
 * The process ports a mounted auth declaration runs on, as a test supplies
 * them: the person a request carried where it carried one, and an
 * authorization answer the test decides.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request. Both halves are absent when signed out. */
export type AuthTrpcTestContext = {
  actor?: { id: string } | undefined;
  email?: string | null;
  /** The address the process resolved, or none. */
  address?: string | null;
  /** The addresses this deployment configured to see the operator entry. */
  operators?: string[] | null;
};

export function authTrpcTestPorts(): TrpcRuntimePorts<AuthTrpcTestContext> {
  return {
    identity: {
      caller: (ctx) => {
        if (!ctx.actor) throw new Error("this test context carries no caller");

        return { actor: { type: "user", id: ctx.actor.id } };
      },
    },
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

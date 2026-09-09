/**
 * The process ports a mounted billing declaration runs on, as a test supplies
 * them: a caller, their address, the request headers, and one authorization
 * answer the test decides.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: the caller, their address, its headers. */
export type BillingTrpcTestContext = {
  actor: { id: string } | null;
  email?: string | null;
  headers?: Record<string, string | string[] | undefined> | null;
};

/** Whether the caller holds one permission on the scope the input named. */
export type BillingTrpcTestDecision = (permission: string) => boolean;

export function billingTrpcTestPorts(
  permits: BillingTrpcTestDecision = () => true,
): TrpcRuntimePorts<BillingTrpcTestContext> {
  return {
    identity: {
      caller: (ctx) =>
        ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null },
    },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
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

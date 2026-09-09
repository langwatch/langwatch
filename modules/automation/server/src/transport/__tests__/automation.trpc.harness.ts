/**
 * The process ports a mounted automation declaration runs on, as a test
 * supplies them: one signed-in person, an authorization answer the test
 * decides, and an audit trail it can read back.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: the caller, and their address. */
export type AutomationTrpcTestContext = {
  actor: { id: string } | null;
  email?: string | null;
  address?: string | null;
};

/** Whether the caller holds one permission on the scope the input named. */
export type AutomationTrpcTestDecision = (permission: string) => boolean;

export function automationTrpcTestPorts(
  permits: AutomationTrpcTestDecision = () => true,
): TrpcRuntimePorts<AutomationTrpcTestContext> {
  return {
    identity: {
      caller: (ctx) => (ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null }),
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
